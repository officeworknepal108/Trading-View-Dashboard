"""Read-only demo verification. Never submits orders or updates dashboard state."""
import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

root=Path(__file__).resolve().parent
sys.path.insert(0,str(root.parent))
import MetaTrader5 as mt5
import mt5_bridge as bridge

parser=argparse.ArgumentParser();parser.add_argument('phase',choices=['export','size']);args=parser.parse_args()
assert mt5.initialize(path=r'C:\Program Files\MetaTrader 5- Account 2\terminal64.exe',timeout=5000)
try:
    account=mt5.account_info()
    assert account and account.trade_mode==mt5.ACCOUNT_TRADE_MODE_DEMO,'Verified demo required'
    symbol='XAUUSDm';info=mt5.symbol_info(symbol);tick=mt5.symbol_info_tick(symbol)
    assert info and tick
    cfg=json.loads((root.parent/'data/mt5-automation.secondary.json').read_text())
    risk_percent=float(cfg['scalpOneToOneRiskPercent'])
    allowance=float(account.equity)*risk_percent/100
    if args.phase=='export':
        candles={}
        for label,tf,count in [('M15',mt5.TIMEFRAME_M15,5000),('H1',mt5.TIMEFRAME_H1,1500),('H4',mt5.TIMEFRAME_H4,700)]:
            rates=mt5.copy_rates_from_pos(symbol,tf,0,count)
            assert rates is not None and len(rates)>100
            candles[label]=bridge.mt5_rates_to_candles(rates,0)
        output={'demoVerified':True,'symbol':symbol,'exportedUTC':datetime.now(timezone.utc).isoformat(),
                'lastTickUTC':datetime.fromtimestamp(tick.time,timezone.utc).isoformat(),
                'quoteFresh':0<=time.time()-tick.time<=120,'riskPercent':risk_percent,'allowance':allowance,
                'contractOz':info.trade_contract_size,'minimumLot':info.volume_min,'lotStep':info.volume_step,'candles':candles}
        (root/'abhi-demo-market-snapshot-2026-11-21.json').write_text(json.dumps(output)+'\n')
        print(json.dumps({k:v for k,v in output.items() if k!='candles'}))
    else:
        plans=json.loads((root/'abhi-demo-plans-2026-11-21.json').read_text())
        checks=[]
        bridge.ALLOW_LIVE_EXECUTION=False
        config={'dryRun':True,'scalpOneToOneRiskPercent':risk_percent}
        for pair in plans['historicalSamplePairs']:
            sizes=[];below=False
            for raw in pair:
                signal={**raw,'scalpSetupRiskBudget':allowance}
                bridge.validate_scalp_pullback(signal)
                rounded=bridge.quantized_pullback_signal(signal,info)
                try:volume=bridge.calculate_volume(rounded,config,info)
                except bridge.BelowMinimumLot:below=True;volume=0
                sizes.append(volume)
            if below:
                signal={**pair[1],'scalpSetupRiskBudget':allowance,'pullbackFallback':'SECOND_ONLY'}
                rounded=bridge.quantized_pullback_signal(signal,info)
                try:sizes=[0,bridge.calculate_volume(rounded,config,info)]
                except bridge.BelowMinimumLot:sizes=[0,0]
            with patch.object(bridge,'update_status'),patch.object(mt5,'order_send',side_effect=AssertionError('Order submission is forbidden in this verification')) as send:
                result=bridge.place_signal({**pair[1],'scalpSetupRiskBudget':allowance},config)
                assert result['status']=='SIMULATED';send.assert_not_called()
            checks.append({'confirmationUTC':datetime.fromtimestamp(pair[0]['calculatedAt'],timezone.utc).isoformat(),
                           'firstLot':sizes[0],'secondLot':sizes[1],'secondOnly':below,'dryRunStatus':result['status']})
            checks[-1]['sizingStatus']='SKIPPED_BELOW_MINIMUM' if not any(sizes) else 'SIZED_WITHIN_ALLOWANCE'
        assert mt5.account_info().trade_mode==mt5.ACCOUNT_TRADE_MODE_DEMO
        output={'demoVerified':True,'symbol':symbol,'riskPercentFromExistingDemoConfig':risk_percent,
                'frozenSetupAllowanceForCheck':allowance,'quoteFresh':0<=time.time()-tick.time<=120,
                'newEligiblePairsNow':plans['newEligiblePairsNow'],'historicalPairsSized':len(checks),
                'ordersSubmitted':0,'checks':checks,
                'forwardTradeStatus':'Waiting for a fresh broker quote and a new qualifying setup. This is a calculation/dry-run verification, not demo trade execution.'}
        (root/'abhi-demo-verification-2026-11-21.json').write_text(json.dumps(output,indent=2)+'\n')
        print(json.dumps(output,indent=2))
finally:
    mt5.shutdown()

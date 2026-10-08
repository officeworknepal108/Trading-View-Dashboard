# Multi-account MT5 plan

Recorded: 2026-10-08

## User requirement

The dashboard should eventually support logging in to and automatically managing
multiple funded or live MT5 accounts from different brokers or prop firms. A
likely target is eight accounts on one Windows laptop or VPS.

## Agreed architecture

- Keep one unified dashboard for viewing and controlling every account.
- Run one separate MT5 terminal installation for each account. Each terminal
  must be installed in a different directory and remain logged in to only its
  assigned account.
- Run one isolated Python bridge for each terminal.
- Give every bridge its own terminal path, bridge ID, account configuration,
  state file, logs, and signal-delivery state.
- Do not implement multi-account execution by repeatedly switching logins in a
  single MT5 terminal. A terminal may save multiple broker logins, but only one
  account is actively connected at a time. Switching would interrupt monitoring,
  RF management, and reliable simultaneous execution.
- The existing demo terminal can become Account 1. Additional accounts require
  additional terminal installations.

Proposed flow:

```text
Dashboard strategy and signal engine
                 |
          Multi-account router
                 |
    +------------+------------+
    |            |            |
 Account 1    Account 2    Account 3 ... Account 8
 MT5 + bridge MT5 + bridge MT5 + bridge   MT5 + bridge
```

## Required account controls

For every account, the dashboard should show and control:

- Friendly account/firm name, login number, server, and connection health.
- Balance, equity, running profit/loss, and open positions.
- Independent enable/disable control for automatic execution.
- Independent risk percentage, maximum open trades, and daily-loss limit.
- Independent lot-size calculation using that account's equity and broker
  contract/tick specifications.
- Broker-specific symbol mapping, for example `XAUUSD`, `GOLD`, or `XAUUSD.a`.
- Independent order acknowledgement, rejection reason, RF management, SL/TP
  lifecycle, journal records, and recovery after restart.
- Account-level and combined exposure before broadcasting a signal.

The signal queue must be redesigned for fan-out delivery. Starting several
copies of the current single-account bridge is not sufficient because bridges
could compete for and claim the same queue item. Every eligible account needs a
separate delivery record and acknowledgement.

## Risk example discussed

For eight accounts of USD 25,000 each at 0.25% risk per trade:

- Risk per account per trade: USD 62.50.
- Combined exposure if all eight take the same signal: USD 500.
- A personal 2% daily cap equals USD 500 per account.
- The combined theoretical daily cap is USD 4,000, subject to each firm's actual
  rules and any stricter portfolio-level protection we implement.

## Compliance requirement

Technical support does not mean every account is permitted to receive the same
trade. Before enabling an account, confirm the current rules of its exact prop
firm, account product, phase, platform, and automation add-on in writing.

Important FundedNext discussion:

- A USD 25,000 MT4/MT5 account may be eligible for EA/bot use under the firm's
  current rules, but required fees/add-ons and strategy restrictions still apply.
- Eight USD 25,000 accounts total USD 200,000, below the generally stated USD
  300,000 allocation ceiling, subject to country and account-model exceptions.
- Copying can be permitted between the trader's own FundedNext Challenge
  accounts under current conditions, but identical copying involving funded
  FundedNext Accounts is restricted. Do not broadcast identical automated trades
  to funded accounts unless FundedNext gives explicit written approval for that
  exact arrangement.
- All FundedNext trading accounts must remain under one permitted user profile.

FundingPips, SharkFunded, and every other firm must be evaluated separately.
The future router must be able to exclude an account or apply a permitted unique
strategy rather than automatically sending every signal everywhere.

## Laptop deployment

Eight terminals can be installed on one Windows machine when each uses a unique
installation directory. Actual capacity depends on RAM, CPU, charts, indicators,
history, and bridge load. For reliability, keep terminals lightweight, prevent
sleep, maintain stable internet and power, and consider a Windows VPS for
continuous operation.

Example directory layout:

```text
C:\MT5-Accounts\FundedNext-1
C:\MT5-Accounts\FundingPips-1
C:\MT5-Accounts\SharkFunded-1
C:\MT5-Accounts\Account-4
...
C:\MT5-Accounts\Account-8
```

## Reminder for future requests

When the user asks to log in with many funded accounts, use this architecture:
one separate MT5 terminal and isolated bridge per account, connected to one
unified dashboard, with independent risk and lifecycle management and strict
prop-firm permission checks. Do not recommend rapid account switching inside a
single terminal for simultaneous automated trading.

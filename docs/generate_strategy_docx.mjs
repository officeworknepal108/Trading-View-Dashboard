import fs from 'node:fs';
import path from 'node:path';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

const docsDirectory = path.resolve(process.cwd(), 'docs');
const markdownPath = path.join(docsDirectory, 'LARAVEL_STRATEGY_IMPLEMENTATION_SPEC.md');
const outputPath = path.join(docsDirectory, 'XAUUSD_Laravel_Strategy_Implementation_Spec.docx');
const markdown = fs.readFileSync(markdownPath, 'utf8').replace(/\r\n/g, '\n');

function inlineRuns(text, options = {}) {
  const runs = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) runs.push(new TextRun({ text: text.slice(last, match.index), ...options }));
    const token = match[0];
    if (token.startsWith('**')) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true, ...options }));
    } else {
      runs.push(new TextRun({ text: token.slice(1, -1), font: 'Consolas', color: '7C2D12', ...options }));
    }
    last = match.index + token.length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), ...options }));
  return runs.length ? runs : [new TextRun({ text, ...options })];
}

function tableFromLines(lines) {
  const rows = lines
    .filter((_, index) => index !== 1)
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
  const columnCount = Math.max(...rows.map((row) => row.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: rowIndex === 0,
      children: Array.from({ length: columnCount }, (_, columnIndex) => new TableCell({
        shading: rowIndex === 0 ? { type: ShadingType.CLEAR, fill: 'DCE6F1' } : undefined,
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
        children: [new Paragraph({
          children: inlineRuns(row[columnIndex] ?? '', { bold: rowIndex === 0, size: 18 }),
          spacing: { after: 0 },
        })],
      })),
    })),
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'AAB7C4' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'AAB7C4' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'AAB7C4' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'AAB7C4' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'D4DCE4' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'D4DCE4' },
    },
  });
}

const children = [];
const lines = markdown.split('\n');
let inCode = false;
let codeLines = [];

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  if (line.startsWith('```')) {
    if (inCode) {
      children.push(new Paragraph({
        children: [new TextRun({ text: codeLines.join('\n'), font: 'Consolas', size: 17, color: '1F2937' })],
        shading: { type: ShadingType.CLEAR, fill: 'F3F4F6' },
        border: {
          top: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
          left: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
          right: { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' },
        },
        spacing: { before: 100, after: 160 },
      }));
      codeLines = [];
      inCode = false;
    } else {
      inCode = true;
    }
    continue;
  }
  if (inCode) {
    codeLines.push(line);
    continue;
  }
  if (line.trim().startsWith('|') && lines[index + 1]?.trim().match(/^\|?\s*:?-+/)) {
    const tableLines = [line, lines[index + 1]];
    index += 2;
    while (index < lines.length && lines[index].trim().startsWith('|')) {
      tableLines.push(lines[index]);
      index += 1;
    }
    index -= 1;
    children.push(tableFromLines(tableLines));
    children.push(new Paragraph({ spacing: { after: 120 } }));
    continue;
  }
  const heading = line.match(/^(#{1,3})\s+(.+)$/);
  if (heading) {
    const level = heading[1].length;
    children.push(new Paragraph({
      text: heading[2],
      heading: level === 1 ? HeadingLevel.TITLE : level === 2 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
      pageBreakBefore: level === 2 && /^\d+\./.test(heading[2]) && children.length > 5,
      spacing: { before: level === 1 ? 0 : 240, after: 120 },
    }));
    continue;
  }
  const bullet = line.match(/^\s*-\s+(.+)$/);
  if (bullet) {
    children.push(new Paragraph({
      children: inlineRuns(bullet[1]),
      bullet: { level: 0 },
      spacing: { after: 55 },
    }));
    continue;
  }
  const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/);
  if (numbered) {
    children.push(new Paragraph({
      children: inlineRuns(`${numbered[1]}. ${numbered[2]}`),
      indent: { left: 360, hanging: 260 },
      spacing: { after: 55 },
    }));
    continue;
  }
  if (line.startsWith('> ')) {
    children.push(new Paragraph({
      children: inlineRuns(line.slice(2), { italics: true, color: '374151' }),
      indent: { left: 360, right: 240 },
      shading: { type: ShadingType.CLEAR, fill: 'FFF7ED' },
      border: { left: { style: BorderStyle.SINGLE, size: 10, color: 'F59E0B' } },
      spacing: { before: 100, after: 140 },
    }));
    continue;
  }
  if (!line.trim()) {
    continue;
  }
  children.push(new Paragraph({
    children: inlineRuns(line),
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 110, line: 280 },
  }));
}

const document = new Document({
  creator: 'Codex',
  title: 'XAUUSD Laravel Strategy Implementation Specification',
  description: 'Engineering specification for reproducing the existing strategy in Laravel/PHP.',
  styles: {
    default: {
      document: { run: { font: 'Aptos', size: 21, color: '111827' } },
      title: { run: { font: 'Aptos Display', size: 38, bold: true, color: '0F3D5E' } },
      heading1: { run: { font: 'Aptos Display', size: 29, bold: true, color: '0F3D5E' } },
      heading2: { run: { font: 'Aptos Display', size: 24, bold: true, color: '1F5F79' } },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: { top: 720, right: 720, bottom: 720, left: 720 },
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'XAUUSD Laravel Strategy Specification  |  Page ', size: 16, color: '64748B' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '64748B' }),
          ],
        })],
      }),
    },
    children,
  }],
});

fs.writeFileSync(outputPath, await Packer.toBuffer(document));
console.log(outputPath);

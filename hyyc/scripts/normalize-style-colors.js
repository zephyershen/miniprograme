const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const STYLE_ROOTS = ['pages', 'components', 'features'];

const COLOR_TOKENS = Object.freeze({
  '#1d9bf0': '--ui-accent',
  '#16222c': '--ui-ink',
  '#111c25': '--ui-ink',
  '#17232d': '--ui-ink',
  '#15212b': '--ui-ink',
  '#111b24': '--ui-ink',
  '#102638': '--ui-ink',
  '#173042': '--ui-ink',
  '#1a2631': '--ui-ink',
  '#172c3b': '--ui-ink',
  '#132431': '--ui-ink',
  '#14212b': '--ui-ink',
  '#26323b': '--ui-ink',
  '#22272f': '--ui-ink',
  '#173b52': '--ui-ink',
  '#364550': '--ui-ink-soft',
  '#3f5b6d': '--ui-ink-soft',
  '#33404a': '--ui-ink-soft',
  '#2b3a45': '--ui-ink-soft',
  '#3a4b57': '--ui-ink-soft',
  '#3a4048': '--ui-ink-soft',
  '#42535f': '--ui-ink-soft',
  '#45525c': '--ui-ink-soft',
  '#4f5d68': '--ui-ink-soft',
  '#60727e': '--ui-muted',
  '#6a7883': '--ui-muted',
  '#60707c': '--ui-muted',
  '#52616d': '--ui-muted-strong',
  '#607786': '--ui-muted',
  '#586874': '--ui-muted',
  '#6f7d88': '--ui-muted',
  '#6d7b86': '--ui-muted',
  '#74818c': '--ui-muted-soft',
  '#7b8792': '--ui-muted-soft',
  '#73818c': '--ui-muted-soft',
  '#72808b': '--ui-muted-soft',
  '#788590': '--ui-muted-soft',
  '#667581': '--ui-muted',
  '#52606c': '--ui-muted-strong',
  '#87939e': '--ui-muted-soft',
  '#82909a': '--ui-muted-soft',
  '#8b98a2': '--ui-muted-soft',
  '#8996a0': '--ui-muted-soft',
  '#98a4ae': '--ui-faint',
  '#99a6b1': '--ui-faint',
  '#dfe5e9': '--ui-rule-strong',
  '#e8eef1': '--ui-hairline',
  '#ccd5dc': '--ui-rule-strong',
  '#cfd8df': '--ui-rule-strong',
  '#e6ebf0': '--ui-hairline',
  '#c8d4dc': '--ui-rule-strong',
  '#dce7ee': '--ui-rule-strong',
  '#b8cfdf': '--ui-rule-strong',
  '#cbd8e1': '--ui-rule-strong',
  '#dfe7ec': '--ui-hairline',
  '#e1eaf0': '--ui-hairline',
  '#d6e2ea': '--ui-rule-strong',
  '#e5edf2': '--ui-hairline',
  '#d4e1e9': '--ui-rule-strong',
  '#dbe3e7': '--ui-rule-strong',
  '#d2d4dc': '--ui-rule-strong',
  '#e4ebee': '--ui-hairline',
  '#dce8ef': '--ui-rule-strong',
  '#b3bdc5': '--ui-rule-strong',
  '#e7ecef': '--ui-hairline',
  '#dce7ef': '--ui-rule-strong',
  '#d8e8f2': '--ui-rule-strong',
  '#cfe1ed': '--ui-rule-strong',
  '#e2e4ea': '--ui-surface-muted',
  '#f7f8f9': '--ui-surface-hover',
  '#fbfcfd': '--ui-surface-hover',
  '#e0e2e8': '--ui-surface-muted',
  '#c2c5cf': '--ui-rule-strong',
  '#b6dcf7': '--ui-accent-soft',
  '#d7e9f5': '--ui-accent-soft',
  '#9bc8e6': '--ui-accent-soft',
  '#e8f5fd': '--ui-accent-soft',
  '#8ebfdd': '--ui-accent-soft',
  '#b9d5e7': '--ui-accent-soft',
  '#eef6fb': '--ui-accent-soft',
  '#f4f8fb': '--ui-surface-hover',
  '#f6fbfe': '--ui-surface-hover',
  '#f8fbfd': '--ui-surface-hover',
  '#f6fafc': '--ui-surface-hover',
  '#f7fbfe': '--ui-surface-hover',
  '#176fa8': '--ui-accent-strong',
  '#d99a17': '--ui-amber',
  '#f0bd3d': '--ui-amber',
  '#b9810f': '--ui-amber',
  '#9a6410': '--ui-warning-strong',
  '#a6740f': '--ui-amber',
  '#b8860b': '--ui-amber',
  '#8a5f0c': '--ui-warning-strong',
  '#f2a83b': '--ui-amber',
  '#f2eee3': '--ui-warning-soft',
  '#fff7e8': '--ui-warning-soft',
  '#91611e': '--ui-warning-strong',
  '#fff4e5': '--ui-warning-soft',
  '#a36a18': '--ui-amber',
  '#e2a52a': '--ui-amber',
  '#6d4708': '--ui-warning-strong',
  '#f8dd8a': '--ui-warning-border',
  '#f3d488': '--ui-warning-border',
  '#146f7b': '--ui-teal',
  '#0b7a55': '--ui-success',
  '#197757': '--ui-success',
  '#e6f7f0': '--ui-success-soft',
  '#eaf8f2': '--ui-success-soft',
  '#a34c45': '--ui-danger',
  '#e5484d': '--ui-danger',
  '#cf353d': '--ui-danger',
  '#fff0ef': '--ui-danger-soft',
  '#f6dcdd': '--ui-danger-soft'
});

function styleFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory()
      ? styleFiles(target)
      : (entry.name.endsWith('.wxss') ? [target] : []);
  });
}

function whiteToken(source, offset) {
  const boundary = Math.max(
    source.lastIndexOf(';', offset),
    source.lastIndexOf('{', offset),
    source.lastIndexOf('}', offset)
  );
  const property = source.slice(boundary + 1, offset);
  return /^\s*(?:color|border-color)\s*:/i.test(property)
    ? '--ui-on-accent'
    : '--ui-surface-solid';
}

function normalizeStyles(source) {
  return source.replace(/#[0-9a-fA-F]{3,8}\b/g, (value, offset) => {
    const color = value.toLowerCase();
    if (color === '#fff' || color === '#ffffff') {
      return `var(${whiteToken(source, offset)})`;
    }
    const token = COLOR_TOKENS[color];
    if (!token) throw new Error(`No design token mapping for ${value}`);
    return `var(${token})`;
  });
}

const files = STYLE_ROOTS.flatMap((relativePath) => styleFiles(path.join(ROOT, relativePath)));
files.forEach((file) => {
  const source = fs.readFileSync(file, 'utf8');
  const normalized = normalizeStyles(source);
  if (normalized !== source) fs.writeFileSync(file, normalized);
});

process.stdout.write(`Normalized ${files.length} style files.\n`);

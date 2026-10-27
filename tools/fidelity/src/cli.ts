export interface FidelityCliOptions {
  suite: boolean;
  help: boolean;
  url?: string;
  width?: number;
  height?: number;
  tolerance?: number;
  timeoutMs?: number;
  minimum?: number;
  outDir?: string;
  mobile?: boolean;
  scrollStitch?: boolean;
}

export function parseFidelityArgs(args: readonly string[]): FidelityCliOptions {
  const options: FidelityCliOptions = { suite: false, help: false };
  const seen = new Set<string>();
  for (const arg of args) {
    if (!arg.startsWith('--')) {
      if (options.url) throw new Error('Only one page URL may be supplied');
      options.url = new URL(arg).href;
      continue;
    }
    const separator = arg.indexOf('=');
    const key = separator < 0 ? arg.slice(2) : arg.slice(2, separator);
    const value = separator < 0 ? undefined : arg.slice(separator + 1);
    if (seen.has(key)) throw new Error(`Duplicate option --${key}`);
    seen.add(key);
    if (['suite', 'help', 'mobile', 'scroll-stitch'].includes(key)) {
      if (value !== undefined) throw new Error(`--${key} does not accept a value`);
      if (key === 'suite') options.suite = true;
      if (key === 'help') options.help = true;
      if (key === 'mobile') options.mobile = true;
      if (key === 'scroll-stitch') options.scrollStitch = true;
      continue;
    }
    if (key === 'out') {
      if (!value?.trim()) throw new Error('--out requires a directory');
      options.outDir = value;
      continue;
    }
    if (!['width', 'height', 'tolerance', 'timeout', 'min'].includes(key)) throw new Error(`Unknown option --${key}`);
    if (value === undefined || value.trim() === '') throw new Error(`--${key} requires a numeric value`);
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`--${key} must be finite`);
    if (key === 'min') {
      if (number < 0 || number > 100) throw new Error('--min must be from 0 to 100');
      options.minimum = number;
    } else if (key === 'tolerance') {
      if (!Number.isInteger(number) || number < 0 || number > 255) throw new Error('--tolerance must be an integer from 0 to 255');
      options.tolerance = number;
    } else {
      if (!Number.isInteger(number) || number <= 0) throw new Error(`--${key} must be a positive integer`);
      if (key === 'width') options.width = number;
      if (key === 'height') options.height = number;
      if (key === 'timeout') options.timeoutMs = number;
    }
  }
  if (options.suite && (options.url || options.width !== undefined || options.height !== undefined || options.mobile || options.scrollStitch)) {
    throw new Error('--suite uses its named fixture viewports/readiness; URL, width, height, mobile and scroll-stitch overrides are not allowed');
  }
  return options;
}

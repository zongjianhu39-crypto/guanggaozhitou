const DAILY_SECTION_TITLES = ['大盘结论', '高消耗人群分析', '重点人群点名', '财务与退款修正', '明日执行建议'];
const SINGLE_SECTION_TITLES = ['单品整体结论', '高消耗商品分析', '高效率与低效率商品点名', '转化与加购机会', '明日执行建议'];
const ANALYSIS_SECTION_TITLES = [...new Set([...DAILY_SECTION_TITLES, ...SINGLE_SECTION_TITLES])];

export function getAnalysisSectionTitles(analysisType: string): string[] {
  return analysisType === 'single' ? SINGLE_SECTION_TITLES : DAILY_SECTION_TITLES;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#+\s*/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^[\d.\s-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAnalysisText(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/```thinking[\s\S]*?```/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripAnalysisPreamble(text: string): string {
  const normalized = normalizeAnalysisText(text);
  if (!normalized) {
    return '';
  }

  const firstSectionIndex = ANALYSIS_SECTION_TITLES
    .map((title) => normalized.indexOf(title))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  const startsWithWeakPreamble = /^(好的，我|好的，|首先，我|根据提供的|让我|下面我|我将|我需要)/.test(normalized);
  if (Number.isInteger(firstSectionIndex) && (startsWithWeakPreamble || firstSectionIndex > 0)) {
    return normalized.slice(firstSectionIndex).trim();
  }

  return normalized;
}

export function sanitizeAnalysisOutput(text: string): string {
  return stripAnalysisPreamble(text)
    .replace(/^(好的，我|好的，|首先，我|根据提供的).*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isWeakAnalysisLine(text: string): boolean {
  return [
    text.includes('我需要作为'),
    text.includes('我需要根据'),
    text.includes('首先，我需要'),
    text.includes('虽然说是昨日数据'),
    text.includes('暂且理解'),
    text.includes('让我思考'),
    text.includes('下面我来'),
    text.startsWith('好的，我'),
    text.startsWith('好的，'),
  ].some(Boolean);
}

export function extractHeadlineFromAnalysis(analysis: string, fallback: string): string {
  const headingOnly = new Set(ANALYSIS_SECTION_TITLES);
  const lines = sanitizeAnalysisOutput(analysis)
    .split('\n')
    .map((line) => stripMarkdown(line))
    .filter((line) => line && !headingOnly.has(line) && !isWeakAnalysisLine(line));

  for (const line of lines) {
    if (line.length >= 12) {
      return line.slice(0, 120);
    }
  }

  return fallback;
}

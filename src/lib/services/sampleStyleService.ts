import type { SampleDocument, StyleProfile, VoiceProfile } from '@/types/style';

const ABSTRACT_TERMS = [
  '伦理',
  '哲学',
  '主体',
  '客体',
  '价值',
  '真实',
  '算法',
  '治理',
  '责任',
  '感官',
  '叙事',
  '结构',
  '逻辑',
  '风险',
];

const DIRECT_ADDRESS_TOKENS = ['姐姐', '你', '我们', '同学'];
const BANNED_CLICHES = [
  '我对XX有浓厚兴趣',
  '从小就',
  '一直以来',
  '贵校是我的梦想',
  '希望通过这个项目提升自己',
];

class SampleStyleService {
  buildProfile(sample?: SampleDocument, fallbackText = ''): StyleProfile {
    const contentExamples = sample?.contentExamples?.filter(Boolean) ?? this.pickFallbackExamples(fallbackText, 3);
    const explanationExamples = sample?.explanationExamples?.filter(Boolean) ?? this.pickFallbackExamples(fallbackText, 3);
    const summaryExamples = sample?.summaryExamples?.filter(Boolean) ?? this.pickFallbackExamples(fallbackText, 2);

    const contentVoice = this.buildVoiceProfile('content', contentExamples);
    const explanationVoice = this.buildVoiceProfile('explanation', explanationExamples);
    const summaryVoice = this.buildVoiceProfile('summary', summaryExamples);

    return {
      sourceLabel: sample?.filename || 'fallback-sample',
      contentVoice,
      explanationVoice,
      summaryVoice,
      globalSignals: this.collectGlobalSignals([contentVoice, explanationVoice, summaryVoice]),
    };
  }

  buildPromptBundle(profile: StyleProfile): {
    contentInstruction: string;
    explanationInstruction: string;
    summaryInstruction: string;
  } {
    return {
      contentInstruction: this.renderVoiceInstruction('正文', profile.contentVoice),
      explanationInstruction: this.renderVoiceInstruction('解释', profile.explanationVoice),
      summaryInstruction: this.renderVoiceInstruction('总结', profile.summaryVoice),
    };
  }

  private buildVoiceProfile(
    role: VoiceProfile['role'],
    examples: string[],
  ): VoiceProfile {
    const joined = examples.join('\n');
    const averageLength = examples.length > 0
      ? examples.reduce((sum, item) => sum + item.replace(/\s+/g, '').length, 0) / examples.length
      : 0;

    const firstPersonIntensity = this.pickIntensity(joined, ['我', '我的', '让我']);
    const preferredAddress = this.pickPreferredAddress(joined);
    const directAddressIntensity = this.pickIntensity(joined, DIRECT_ADDRESS_TOKENS);
    const sentenceLength = averageLength >= 110 ? 'long' : averageLength >= 65 ? 'medium' : 'short';
    const rhetoricalSignals = this.pickRhetoricalSignals(joined);
    const lexicalSignals = ABSTRACT_TERMS.filter((term) => joined.includes(term)).slice(0, 6);

    const guidance: string[] = [];
    if (role === 'content') {
      guidance.push('正文先讲具体经历或观察，再抬升到认知与申请动机。');
      guidance.push('句子允许偏长，但必须推进论证，不要写成简历罗列。');
    } else if (role === 'explanation') {
      guidance.push('解释节点是写作顾问口吻，不是招生官正文。');
      guidance.push('解释要说清这段为什么写、和项目哪里贴合、后文怎么承接。');
    } else {
      guidance.push('总结要起收束作用，避免空泛喊口号。');
    }

    if (preferredAddress) {
      guidance.push(`保留样例里的称呼习惯，优先使用“${preferredAddress}”。`);
    }
    if (lexicalSignals.length > 0) {
      guidance.push(`保留样例里偏高阶的词场，例如：${lexicalSignals.join('、')}。`);
    }

    return {
      role,
      tone: this.describeTone(role, sentenceLength, directAddressIntensity),
      sentenceLength,
      firstPersonIntensity,
      directAddressIntensity,
      preferredAddress,
      rhetoricalSignals,
      lexicalSignals,
      tabooPhrases: BANNED_CLICHES,
      guidance,
      anchorExamples: examples.slice(0, 2).map((item) => this.clipExample(item)),
    };
  }

  private renderVoiceInstruction(label: string, voice: VoiceProfile): string {
    const guidance = voice.guidance.map((item) => `- ${item}`).join('\n');
    const anchors = voice.anchorExamples.length > 0
      ? voice.anchorExamples.map((item, index) => `${index + 1}. ${item}`).join('\n')
      : '1. 无可用锚点';

    return `### ${label}口吻约束
- 基调：${voice.tone}
- 句长：${voice.sentenceLength}
- 第一人称强度：${voice.firstPersonIntensity}
- 直接称呼强度：${voice.directAddressIntensity}${voice.preferredAddress ? `，优先称呼“${voice.preferredAddress}”` : ''}
- 修辞信号：${voice.rhetoricalSignals.join('、') || '以自然转折为主'}
- 禁止套话：${voice.tabooPhrases.join('；')}
${guidance}
参考锚点：
${anchors}`;
  }

  private pickFallbackExamples(text: string, limit: number): string[] {
    return (text || '')
      .split(/\n+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 40)
      .slice(0, limit);
  }

  private pickIntensity(text: string, tokens: string[]): 'low' | 'medium' | 'high' {
    const hits = tokens.reduce((sum, token) => sum + this.countToken(text, token), 0);
    if (hits >= 5) return 'high';
    if (hits >= 2) return 'medium';
    return 'low';
  }

  private pickPreferredAddress(text: string): string | null {
    const ranked = DIRECT_ADDRESS_TOKENS
      .map((token) => ({ token, hits: this.countToken(text, token) }))
      .sort((left, right) => right.hits - left.hits);
    return ranked[0]?.hits ? ranked[0].token : null;
  }

  private pickRhetoricalSignals(text: string): string[] {
    const signals: string[] = [];
    if (text.includes('——')) signals.push('破折号推进');
    if (text.includes('一方面') && text.includes('另一方面')) signals.push('双向对照');
    if (text.includes('不仅') && text.includes('更')) signals.push('递进句');
    if (text.includes('？')) signals.push('设问');
    if (text.includes('；')) signals.push('并列分句');
    if (text.includes('~')) signals.push('轻口语尾音');
    return signals.slice(0, 4);
  }

  private describeTone(
    role: VoiceProfile['role'],
    sentenceLength: VoiceProfile['sentenceLength'],
    directAddressIntensity: VoiceProfile['directAddressIntensity'],
  ): string {
    if (role === 'content') {
      return sentenceLength === 'long'
        ? '高密度、带抽象提升的招生官文书腔'
        : '克制、具体、带明确叙事推进的招生官文书腔';
    }
    if (role === 'explanation') {
      return directAddressIntensity === 'high'
        ? '贴近顾问与学生对话的解释口吻'
        : '口语化但逻辑清楚的说明口吻';
    }
    return '收束、提炼、避免空话的总结口吻';
  }

  private collectGlobalSignals(voices: VoiceProfile[]): string[] {
    const signals = new Set<string>();
    for (const voice of voices) {
      voice.lexicalSignals.forEach((item) => signals.add(item));
      voice.rhetoricalSignals.forEach((item) => signals.add(item));
    }
    return Array.from(signals).slice(0, 8);
  }

  private clipExample(example: string): string {
    const trimmed = example.replace(/\s+/g, ' ').trim();
    return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed;
  }

  private countToken(text: string, token: string): number {
    if (!token) return 0;
    return (text.match(new RegExp(token, 'g')) || []).length;
  }
}

export const sampleStyleService = new SampleStyleService();

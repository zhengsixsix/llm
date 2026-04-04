export type SampleNodeRole =
  | 'root'
  | 'board'
  | 'content'
  | 'explanation'
  | 'summary'
  | 'reference'
  | 'empty';

export interface SampleNode {
  title: string;
  depth: number;
  role: SampleNodeRole;
  children: SampleNode[];
}

export interface SampleDocument {
  filename: string;
  rootTitle: string;
  nodes: SampleNode[];
  renderedText: string;
  contentExamples: string[];
  explanationExamples: string[];
  summaryExamples: string[];
  referenceExamples: string[];
  relationshipExamples: string[];
}

export interface VoiceProfile {
  role: 'content' | 'explanation' | 'summary';
  tone: string;
  sentenceLength: 'short' | 'medium' | 'long' | 'mixed';
  firstPersonIntensity: 'low' | 'medium' | 'high';
  directAddressIntensity: 'low' | 'medium' | 'high';
  preferredAddress: string | null;
  rhetoricalSignals: string[];
  lexicalSignals: string[];
  tabooPhrases: string[];
  guidance: string[];
  anchorExamples: string[];
}

export interface StyleProfile {
  sourceLabel: string;
  contentVoice: VoiceProfile;
  explanationVoice: VoiceProfile;
  summaryVoice: VoiceProfile;
  globalSignals: string[];
}

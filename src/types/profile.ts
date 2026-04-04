export type EvidenceSource = 'resume' | 'website' | 'sample' | 'user';

export interface EvidenceAtom {
  id: string;
  source: EvidenceSource;
  category: string;
  title: string;
  time?: string;
  action?: string;
  outcome?: string;
  metric?: string;
  reflection?: string;
  rawSnippet: string;
}

export interface ResumeProfile {
  candidateSummary: string;
  education: EvidenceAtom[];
  experiences: EvidenceAtom[];
  projects: EvidenceAtom[];
  awards: EvidenceAtom[];
  motivations: EvidenceAtom[];
}

export interface ProgramProfile {
  programSummary: string;
  courses: string[];
  faculty: string[];
  labs: string[];
  fitHooks: string[];
}

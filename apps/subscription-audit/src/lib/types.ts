export type SubscriptionCadence =
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'annual'
  | 'weekly'
  | 'daily'
  | 'unknown';

export type SubscriptionItem = {
  name: string;
  amount: number;
  cadence: SubscriptionCadence;
  notes?: string;
  recommendation?: 'keep' | 'review' | 'cancel';
  confidence?: number;
};

export type AnalysisResult = {
  recordWindowMonths?: number | null;
  summary?: string;
  subscriptions: SubscriptionItem[];
  insights?: string[];
  currency?: string;
};

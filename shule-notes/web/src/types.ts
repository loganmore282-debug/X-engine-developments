export interface User { id: string; name: string; phone: string | null; classLevel: string | null; avatarVersion: number; accessUntil?: string | null }
export interface Level { id: string; name: string; short: string }
export interface LevelGroup { id: string; name: string; levels: Level[] }
export interface Subject { id: string; name: string }
export interface Note {
  id: string; subjectId: string | null; title: string; description: string; classLevel: string | null;
  kind: 'notes' | 'past-paper'; views: number; pageCount: number; fileSize: number; uploadedAt: string | null; hasAiContext: boolean; free?: boolean;
}
export interface Announcement { id: string; title: string; message: string; classLevel?: string | null; createdAt: string }
export interface Slide { id: string; title: string; text: string; imageUrl: string | null }
export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export interface AppConfig {
  supportPhone?: string; supportWhatsapp?: string; supportEmail?: string; supportHours?: string; paymentsEnabled?: boolean;
}
export interface Plan { id: string; name: string; price: number; minutes: number }
export interface Payment { id: string; status: 'pending' | 'paid' | 'failed' | 'expired'; planName: string; amount: number; message: string; accessUntil: string | null }

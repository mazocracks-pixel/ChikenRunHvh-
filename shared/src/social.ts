import type { ModeId } from './modes';

/**
 * Friends and parties. Friends are registered accounts that accepted each other; a party is a
 * group of friends (up to SOCIAL.partySize) whose leader starts matches for everyone, on the
 * same team. The server checks every request; these are just the shapes it sends.
 */
export const SOCIAL = {
  maxFriends: 100,
  /** Unanswered requests you can have out at once. */
  maxPending: 20,
  /** The biggest team is 5 (5 vs 5), so a party fits on one. */
  partySize: 5,
  /** A party invite you don't answer runs out. */
  inviteMs: 60_000,
  /** Lose your connection for this long and you drop out of your party. */
  offlineGraceMs: 30_000,
} as const;

export interface FriendEntry {
  userId: number;
  username: string;
  name: string;
  /** Rank level (1–10). */
  rank: number;
  dev?: boolean;
  online: boolean;
  /** The mode they're playing, or null in the menu (or offline). */
  mode: ModeId | null;
  /** In your party. */
  inParty: boolean;
}

export interface FriendRequestEntry {
  userId: number;
  username: string;
  name: string;
}

export interface FriendsState {
  /** Guests can't have friends: they need a username first. */
  registered: boolean;
  friends: FriendEntry[];
  incoming: FriendRequestEntry[];
  outgoing: FriendRequestEntry[];
}

export interface PartyMember {
  userId: number;
  name: string;
  online: boolean;
  mode: ModeId | null;
}

export interface PartyState {
  id: string;
  leader: number;
  members: PartyMember[];
  /** Invited and not answered yet. */
  invited: { userId: number; name: string }[];
}

export interface PartyInvite {
  partyId: string;
  from: { userId: number; name: string };
  size: number;
}

export interface SocialResult {
  ok: boolean;
  error?: string;
}

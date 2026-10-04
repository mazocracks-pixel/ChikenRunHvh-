import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { SOCIAL, type ClientToServerEvents, type FriendsState, type JoinResponse, type PartyInvite, type PartyState, type ServerToClientEvents, type SocialResult } from '@game/shared';
import { startGameServer, type RunningServer } from '../src/app';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: RunningServer;
let base: string;
const sockets: Client[] = [];

before(async () => {
  server = await startGameServer({ port: 0, dbPath: ':memory:', authPerMinute: 10_000, guestsPerHour: 100_000 });
  base = `http://localhost:${server.port}`;
});
after(async () => {
  for (const s of sockets) s.disconnect();
  await server.close();
});

const guestCookie = async () => {
  const guest = await fetch(`${base}/api/auth/guest`, { method: 'POST' });
  return guest.headers.getSetCookie()[0]!.slice(11).split(';')[0]!;
};
const register = async (username: string) => {
  const cookie = await guestCookie();
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { cookie: `cg_session=${cookie}`, 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'correct-horse-7' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { profile: { id: number } };
  return { cookie: res.headers.getSetCookie().find((c) => c.startsWith('cg_session='))!.slice(11).split(';')[0]!, id: body.profile.id };
};
/** A connected player that remembers what the server pushed to it. */
async function player(username: string | null) {
  const acct = username ? await register(username) : { cookie: await guestCookie(), id: 0 };
  const s: Client = connect(base, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: `cg_session=${acct.cookie}` } });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', reject);
  });
  const seen = { friends: null as FriendsState | null, party: undefined as PartyState | null | undefined, invites: [] as PartyInvite[], joined: [] as JoinResponse[], notices: [] as string[] };
  s.on('friends', (f) => (seen.friends = f));
  s.on('party', (p) => (seen.party = p));
  s.on('partyInvited', (i) => seen.invites.push(i));
  s.on('partyJoined', (j) => seen.joined.push(j));
  s.on('notice', (n) => seen.notices.push(n));
  return { id: acct.id, username, s, seen };
}
type Player = Awaited<ReturnType<typeof player>>;
const call = <T>(fn: (ack: (r: T) => void) => void) => new Promise<T>((resolve) => fn(resolve));
const req = (p: Player, username: string) => call<SocialResult>((ack) => p.s.emit('friendRequest', username, ack));
const list = (p: Player) => call<FriendsState>((ack) => p.s.emit('friendsList', ack));
/** Waits until `check` passes (server pushes arrive a moment later). */
async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(`timed out waiting for ${what}`);
}
async function befriend(a: Player, b: Player) {
  assert.deepEqual(await req(a, b.username!), { ok: true });
  assert.deepEqual(await call<SocialResult>((ack) => b.s.emit('friendRespond', { userId: a.id, accept: true }, ack)), { ok: true });
}

describe('friends', () => {
  it('request, accept, see each other online, and see what they play', async () => {
    const ana = await player('ana_hen');
    const bob = await player('bob_rooster');
    assert.deepEqual(await req(ana, 'BOB_rooster'), { ok: true }, 'usernames ignore case');
    await until(() => (bob.seen.friends?.incoming.length ?? 0) === 1, "bob's request");
    assert.equal(bob.seen.friends!.incoming[0]!.username, 'ana_hen');
    assert.ok(bob.seen.notices.some((n) => /wants to be friends/.test(n)));
    assert.equal((await list(ana)).outgoing[0]!.username, 'bob_rooster');
    assert.equal((await req(ana, 'bob_rooster')).error, 'You already asked them.');

    assert.deepEqual(await call<SocialResult>((ack) => bob.s.emit('friendRespond', { userId: ana.id, accept: true }, ack)), { ok: true });
    await until(() => ana.seen.friends?.friends.length === 1, "ana's friend list");
    const seenBob = ana.seen.friends!.friends[0]!;
    assert.equal(seenBob.username, 'bob_rooster');
    assert.equal(seenBob.online, true);
    assert.equal(seenBob.mode, null, 'in the menu');
    assert.equal((await list(bob)).friends[0]!.username, 'ana_hen');

    // Bob starts a match: Ana sees it. Then he goes offline.
    assert.ok((await call<JoinResponse>((ack) => bob.s.emit('quickPlay', { mode: 'tdm' }, ack))).ok);
    await until(() => ana.seen.friends?.friends[0]?.mode === 'tdm', 'bob playing Team Fight');
    bob.s.disconnect();
    await until(() => ana.seen.friends?.friends[0]?.online === false, 'bob offline');
  });

  it("asking someone who asked you is a yes; unfriending works both ways", async () => {
    const cat = await player('cat_chick');
    const dan = await player('dan_egg');
    await req(cat, 'dan_egg');
    assert.deepEqual(await req(dan, 'cat_chick'), { ok: true });
    assert.equal((await list(cat)).friends.length, 1);
    assert.deepEqual(await call<SocialResult>((ack) => cat.s.emit('friendRemove', dan.id, ack)), { ok: true });
    assert.equal((await list(cat)).friends.length, 0);
    assert.equal((await list(dan)).friends.length, 0);
  });

  it('guests, yourself, nobody and declines', async () => {
    const guest = await player(null);
    const eve = await player('eve_pullet');
    assert.equal((await list(guest)).registered, false);
    assert.match((await req(guest, 'eve_pullet')).error!, /Register/);
    assert.equal((await req(eve, 'eve_pullet')).error, "That's you!");
    assert.match((await req(eve, 'nobody_here')).error!, /Nobody is called/);
    assert.match((await req(eve, 'bad name!')).error!, /Usernames/);
    const fay = await player('fay_hen');
    await req(fay, 'eve_pullet');
    assert.deepEqual(await call<SocialResult>((ack) => eve.s.emit('friendRespond', { userId: fay.id, accept: false }, ack)), { ok: true });
    assert.equal((await list(fay)).outgoing.length, 0, 'declined: gone');
    assert.equal((await call<SocialResult>((ack) => eve.s.emit('friendRespond', { userId: fay.id, accept: true }, ack))).error, 'That request is gone.');
  });
});

describe('parties', () => {
  it('friends only; invite, join, and the leader takes everyone into one match on one team', async () => {
    const lead = await player('lead_cock');
    const m1 = await player('mate_one');
    const m2 = await player('mate_two');
    const stranger = await player('stranger_x');
    await befriend(lead, m1);
    await befriend(lead, m2);
    assert.equal((await call<SocialResult>((ack) => lead.s.emit('partyInvite', stranger.id, ack))).error, 'You can only invite friends.');

    assert.deepEqual(await call<SocialResult>((ack) => lead.s.emit('partyInvite', m1.id, ack)), { ok: true });
    await until(() => m1.seen.invites.length === 1, 'the invite');
    const invite = m1.seen.invites[0]!;
    assert.equal(invite.from.userId, lead.id);
    assert.deepEqual(await call<SocialResult>((ack) => m1.s.emit('partyAnswer', { partyId: invite.partyId, accept: true }, ack)), { ok: true });
    await call<SocialResult>((ack) => lead.s.emit('partyInvite', m2.id, ack));
    await until(() => m2.seen.invites.length === 1, 'the second invite');
    await call<SocialResult>((ack) => m2.s.emit('partyAnswer', { partyId: m2.seen.invites[0]!.partyId, accept: true }, ack));
    await until(() => lead.seen.party?.members.length === 3, 'a party of three');
    assert.equal(lead.seen.party!.leader, lead.id);
    assert.equal((await call<SocialResult>((ack) => m1.s.emit('partyInvite', stranger.id, ack))).error, 'You can only invite friends.');

    // Only the leader starts matches.
    const notLeader = await call<JoinResponse>((ack) => m1.s.emit('quickPlay', { mode: 'tdm' }, ack));
    assert.equal(notLeader.ok, false);
    assert.match(notLeader.ok ? '' : notLeader.error, /party leader/);

    const res = await call<JoinResponse>((ack) => lead.s.emit('quickPlay', { mode: 'tdm' }, ack));
    assert.ok(res.ok, res.ok ? '' : res.error);
    await until(() => m1.seen.joined.length === 1 && m2.seen.joined.length === 1, 'the party pulled in');
    const roomIds = [res, m1.seen.joined[0]!, m2.seen.joined[0]!].map((r) => (r.ok ? r.room.id : ''));
    assert.equal(new Set(roomIds).size, 1, 'one room');
    const room = server.rooms.get(res.ok ? res.room.id : '')!;
    const teams = [lead, m1, m2].map((p) => [...room.players.values()].find((x) => x.userId === p.id)!.info.team);
    assert.equal(new Set(teams).size, 1, `one team (${teams})`);
    assert.ok(teams[0] === 1 || teams[0] === 2);
    // Bots made room for them: the teams still add up.
    const count = (t: number) => [...room.players.values()].filter((p) => p.info.team === t).length;
    assert.ok(count(1) <= 5 && count(2) <= 5, `teams ${count(1)} vs ${count(2)}`);

    // While they play, the leader can't drag them somewhere else... nor can anyone start without them.
    lead.s.emit('leaveRoom');
    const busy = await call<JoinResponse>((ack) => lead.s.emit('quickPlay', { mode: 'ffa' }, ack));
    assert.match(busy.ok ? '' : busy.error, /Waiting for/);

    // Leaving: the next member leads; one left disbands it.
    assert.deepEqual(await call<SocialResult>((ack) => lead.s.emit('partyLeave', ack)), { ok: true });
    await until(() => m1.seen.party?.members.length === 2 && m1.seen.party.leader === m1.id, 'new leader');
    await call<SocialResult>((ack) => m1.s.emit('partyLeave', ack));
    await until(() => m2.seen.party === null, 'party over');
  });

  it(`at most ${SOCIAL.partySize}, and a party only goes where it fits on one team`, async () => {
    const lead = await player('big_boss');
    const mates: Player[] = [];
    for (let i = 0; i < SOCIAL.partySize; i++) mates.push(await player(`big_mate${i}`));
    for (const m of mates) await befriend(lead, m);
    for (const m of mates.slice(0, SOCIAL.partySize - 1)) {
      await call<SocialResult>((ack) => lead.s.emit('partyInvite', m.id, ack));
      await until(() => m.seen.invites.length > 0, 'invite');
      await call<SocialResult>((ack) => m.s.emit('partyAnswer', { partyId: m.seen.invites.at(-1)!.partyId, accept: true }, ack));
    }
    await until(() => lead.seen.party?.members.length === SOCIAL.partySize, 'a full party');
    assert.match((await call<SocialResult>((ack) => lead.s.emit('partyInvite', mates.at(-1)!.id, ack))).error!, /full/);

    // Knife Fight is 3 vs 3: a party of 5 can't be one team there.
    const knife = await call<JoinResponse>((ack) => lead.s.emit('quickPlay', { mode: 'knife' }, ack));
    assert.equal(knife.ok, false);
    // Team Fight (5 vs 5): all five on one side.
    const tdm = await call<JoinResponse>((ack) => lead.s.emit('quickPlay', { mode: 'tdm' }, ack));
    assert.ok(tdm.ok, tdm.ok ? '' : tdm.error);
    const room = server.rooms.get(tdm.ok ? tdm.room.id : '')!;
    await until(() => [lead, ...mates.slice(0, 4)].every((p) => [...room.players.values()].some((x) => x.userId === p.id)), 'all five in');
    const teams = new Set([lead, ...mates.slice(0, 4)].map((p) => [...room.players.values()].find((x) => x.userId === p.id)!.info.team));
    assert.equal(teams.size, 1);
  });
});

import { supabase } from '@services/supabase';
import type { Database, FriendStatus } from '@app-types/index';

type FriendRow   = Database['public']['Tables']['friends']['Row'];
type ProfileRow  = Database['public']['Tables']['profiles']['Row'];

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Fetch all friend relationships for a user in any status.
 * Returns the nested profile of the other party on each row.
 */
export async function getFriends(
  userId: string,
  status: FriendStatus = 'accepted',
): Promise<(FriendRow & { other_profile: ProfileRow })[]> {
  // Supabase cannot filter "requester OR addressee" in a single .eq() call,
  // so we fetch both directions and merge client-side.
  const [asRequester, asAddressee] = await Promise.all([
    supabase
      .from('friends')
      .select('*, other_profile:profiles!addressee_id(*)')
      .eq('requester_id', userId)
      .eq('status', status),
    supabase
      .from('friends')
      .select('*, other_profile:profiles!requester_id(*)')
      .eq('addressee_id', userId)
      .eq('status', status),
  ]);

  if (asRequester.error) throw asRequester.error;
  if (asAddressee.error) throw asAddressee.error;

  return [
    ...((asRequester.data ?? []) as (FriendRow & { other_profile: ProfileRow })[]),
    ...((asAddressee.data ?? []) as (FriendRow & { other_profile: ProfileRow })[]),
  ];
}

/**
 * Fetch pending requests sent TO the current user (incoming).
 */
export async function getIncomingRequests(
  userId: string,
): Promise<(FriendRow & { other_profile: ProfileRow })[]> {
  const { data, error } = await supabase
    .from('friends')
    .select('*, other_profile:profiles!requester_id(*)')
    .eq('addressee_id', userId)
    .eq('status', 'pending');

  if (error) throw error;
  return (data ?? []) as (FriendRow & { other_profile: ProfileRow })[];
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Send a friend request from the current user to another user.
 * The canonical_a / canonical_b columns are set by DB trigger — no need
 * to supply them here.
 */
export async function sendFriendRequest(
  requesterId: string,
  addresseeId: string,
): Promise<FriendRow> {
  const { data, error } = await supabase
    .from('friends')
    .insert({ requester_id: requesterId, addressee_id: addresseeId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Accept a pending friend request.
 * Only the addressee should call this.
 */
export async function acceptFriendRequest(friendId: string): Promise<void> {
  const { error } = await supabase
    .from('friends')
    .update({ status: 'accepted' })
    .eq('id', friendId);

  if (error) throw error;
}

/**
 * Block a user (update status to 'blocked').
 * Either party can block.
 */
export async function blockUser(friendId: string): Promise<void> {
  const { error } = await supabase
    .from('friends')
    .update({ status: 'blocked' })
    .eq('id', friendId);

  if (error) throw error;
}

/**
 * Remove a friendship or withdraw a pending request.
 * Either party can delete.
 */
export async function removeFriend(friendId: string): Promise<void> {
  const { error } = await supabase
    .from('friends')
    .delete()
    .eq('id', friendId);

  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Profile search — used when adding a new friend by username
// ---------------------------------------------------------------------------

/**
 * Search profiles by username prefix.
 * Returns up to 10 results, excluding the current user.
 */
export async function searchProfiles(
  query: string,
  currentUserId: string,
): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .ilike('username', `${query}%`)
    .neq('id', currentUserId)
    .limit(10);

  if (error) throw error;
  return data ?? [];
}

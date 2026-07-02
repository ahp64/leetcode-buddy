import { dayKey } from './time.js';

const GRAPHQL_URL = 'https://leetcode.com/graphql';
const CACHE_TTL_MS = 2 * 60 * 1000;

const cache = new Map(); // username -> { at, submissions }

async function gql(query, variables) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://leetcode.com',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`LeetCode API returned HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`LeetCode API error: ${json.errors[0].message}`);
  }
  return json.data;
}

export async function userExists(username) {
  const data = await gql(
    `query userExists($username: String!) {
       matchedUser(username: $username) { username }
     }`,
    { username }
  );
  return data.matchedUser !== null;
}

// Most recent accepted submissions (LeetCode caps how many it returns, so
// this covers roughly the last few weeks for a typical daily solver).
export async function recentAcSubmissions(username, { fresh = false } = {}) {
  const cached = cache.get(username);
  if (!fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.submissions;
  }
  const data = await gql(
    `query recentAc($username: String!, $limit: Int!) {
       recentAcSubmissionList(username: $username, limit: $limit) {
         title
         titleSlug
         timestamp
       }
     }`,
    { username, limit: 100 }
  );
  const submissions = data.recentAcSubmissionList ?? [];
  cache.set(username, { at: Date.now(), submissions });
  return submissions;
}

// Returns { days: Map<dayKey, count>, lastSolve } for a member.
export async function memberActivity(username, timeZone, opts) {
  const submissions = await recentAcSubmissions(username, opts);
  const days = new Map();
  for (const sub of submissions) {
    const key = dayKey(new Date(Number(sub.timestamp) * 1000), timeZone);
    days.set(key, (days.get(key) ?? 0) + 1);
  }
  const lastSolve = submissions[0]
    ? { title: submissions[0].title, timestamp: Number(submissions[0].timestamp) }
    : null;
  return { days, lastSolve };
}

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Mustache from "mustache";
import { Octokit } from "@octokit/rest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, "template.mustache");
const OUTPUT_PATH = resolve(__dirname, "README.md");
const MS_PER_SECOND = 1000;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const accessToken = requireEnv("ACCESS_TOKEN");
const username = requireEnv("USERNAME");

const octokit = new Octokit({
  auth: accessToken,
  userAgent: "paulmorar-readme v2.0.0",
  log: {
    warn: console.warn,
    error: console.error,
  },
});

async function getUserData() {
  const { data } = await octokit.rest.users.getAuthenticated();
  return {
    followers: data.followers,
    following: data.following,
    publicRepos: data.public_repos,
  };
}

async function getDataFromAllRepositories() {
  return octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
    per_page: 100,
  });
}

function calculateTotalStars(repos) {
  return repos.reduce((sum, repo) => sum + (repo.stargazers_count ?? 0), 0);
}

async function fetchContributorStats(repo) {
  try {
    const { data } = await octokit.rest.repos.getContributorsStats({
      owner: username,
      repo: repo.name,
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn(`Failed to fetch stats for ${repo.name}: ${err.message}`);
    return [];
  }
}

function countCommitsForContributor(stats, cutoffDate) {
  const entry = stats.find((item) => item?.author?.login === username);
  if (!entry) return 0;

  if (!cutoffDate) return entry.total ?? 0;

  return (entry.weeks ?? [])
    .filter((week) => new Date(week.w * MS_PER_SECOND) > cutoffDate)
    .reduce((sum, week) => sum + (week.c ?? 0), 0);
}

async function calculateTotalCommits(repos, cutoffDate) {
  const eligibleRepos = cutoffDate
    ? repos.filter((repo) => new Date(repo.updated_at) > cutoffDate)
    : repos;

  const statsByRepo = await Promise.all(
    eligibleRepos.map(fetchContributorStats),
  );
  return statsByRepo.reduce(
    (total, stats) => total + countCommitsForContributor(stats, cutoffDate),
    0,
  );
}

async function renderReadme(view) {
  const template = await readFile(TEMPLATE_PATH, "utf8");
  const output = Mustache.render(template, view);
  await writeFile(OUTPUT_PATH, output);
}

async function main() {
  const lastYear = new Date();
  lastYear.setFullYear(lastYear.getFullYear() - 1);

  const [userData, repoData] = await Promise.all([
    getUserData(),
    getDataFromAllRepositories(),
  ]);

  const totalStars = calculateTotalStars(repoData);
  const totalCommitsInPastYear = await calculateTotalCommits(
    repoData,
    lastYear,
  );

  await renderReadme({ ...userData, totalStars, totalCommitsInPastYear });
  console.log("README.md generated successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

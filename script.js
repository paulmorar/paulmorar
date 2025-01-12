require("dotenv").config();
const Mustache = require("mustache");
const fs = require("fs");
const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({
  auth: process.env.ACCESS_TOKEN,
  userAgent: "readme v1.0.0",
  baseUrl: "https://api.github.com",
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
  // Options under "List repositories for the authenticated user"
  // https://octokit.github.io/rest.js/v18#authentication
  const options = {
    per_page: 100,
  };

  // https://docs.github.com/en/rest/reference/repos#list-repositories-for-the-authenticated-user
  const request = await octokit.rest.repos.listForAuthenticatedUser(options);
  return request.data;
}

function calculateTotalStars(data) {
  const stars = data.map((repo) => repo.stargazers_count);
  const totalStars = stars.reduce((sum, curr) => sum + curr, 0);
  return totalStars;
}

async function calculateTotalCommits(data, cutoffDate) {
  const contributorsRequests = [];
  const githubUsername = process.env.USERNAME;

  data.forEach((repo) => {
    const options = {
      owner: githubUsername,
      repo: repo.name,
    };

    const lastRepoUpdate = new Date(repo.updated_at);

    if (!cutoffDate || lastRepoUpdate > cutoffDate) {
      // https://docs.github.com/en/rest/reference/repos#get-all-contributor-commit-activity
      const repoStats = octokit.rest.repos.getContributorsStats(options);

      contributorsRequests.push(repoStats);
    }
  });

  const totalCommits = await getTotalCommits(
    contributorsRequests,
    githubUsername,
    cutoffDate
  );

  return totalCommits;
}

async function getTotalCommits(requests, contributor, cutoffDate) {
  const repos = await Promise.all(requests);
  let totalCommits = 0;

  repos.forEach((repo) => {
    const contributorName = (item) => item.author.login === contributor;
    if (!repo.data || !repo.data.length) {
      return;
    }
    const indexOfContributor = repo.data.findIndex(contributorName);

    if (indexOfContributor !== -1) {
      const contributorStats = repo.data[indexOfContributor];
      totalCommits += !cutoffDate
        ? computeCommitsFromStart(contributorStats)
        : computeCommitsBeforeCutoff(contributorStats, cutoffDate);
    }
  });

  return totalCommits;
}

function computeCommitsFromStart(contributorData) {
  return contributorData.total;
}

function computeCommitsBeforeCutoff(contributorData, cutoffDate) {
  const olderThanCutoffDate = (week) => {
    // week.w -> Start of the week, given as a Unix timestamp (which is in seconds)
    const MILLISECONDS_IN_A_SECOND = 1000;
    const milliseconds = week.w * MILLISECONDS_IN_A_SECOND;
    const startOfWeek = new Date(milliseconds);
    return startOfWeek > cutoffDate;
  };

  const newestWeeks = contributorData.weeks.filter(olderThanCutoffDate);
  // week.c -> Number of commits in a week
  const total = newestWeeks.reduce((sum, week) => sum + week.c, 0);

  return total;
}

async function updateReadme(userData) {
  const TEMPLATE_PATH = "./template.mustache";
  fs.readFile(TEMPLATE_PATH, (err, data) => {
    if (err) {
      throw err;
    }

    const output = Mustache.render(data.toString(), userData);
    fs.writeFileSync("README.md", output);
  });
}

async function main() {
  const userData = await getUserData();
  const repoData = await getDataFromAllRepositories();

  const totalStars = calculateTotalStars(repoData);

  const lastYear = new Date();
  lastYear.setFullYear(lastYear.getFullYear() - 1);

  const totalCommitsInPastYear = await calculateTotalCommits(
    repoData,
    lastYear
  );
  await updateReadme({ totalStars, totalCommitsInPastYear, ...userData });
}

main();

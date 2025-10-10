/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  generateBuildId: async () => {
    if (process.env.NEXT_BUILD_ID && process.env.NEXT_BUILD_ID.length > 0) {
      return process.env.NEXT_BUILD_ID;
    }
    if (process.env.GITHUB_SHA) {
      return process.env.GITHUB_SHA.slice(0, 12);
    }
    try {
      return require('child_process').execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch (err) {
      return 'openshrooly';
    }
  },
}

module.exports = nextConfig

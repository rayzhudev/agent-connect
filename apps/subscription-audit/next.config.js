/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['@agentconnect/host', 'ws'],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        bufferutil: false,
        'utf-8-validate': false,
      }
    }
    return config
  },
}

module.exports = nextConfig

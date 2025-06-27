// config.js
export const WETH_ADDRESS = 'Example-0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // Mainnet WETH
export const SEAPORT_ADDRESS = 'Example-0x00000000000001ad428e4906aE43D8F9852d0dD6'; // Seaport 1.4
export const OPENSEA_API_URL = 'Example-https://api.opensea.io/api/v1';

export const DEFAULT_CONFIG = {
    buyThreshold: 0.1, // Auto-buy if price < 0.1 ETH
    offerPercentage: 0.8, // Offer 80% of listing price
    maxGasPrice: 50, // in gwei
    pollingInterval: 60000, // 1 minute
    errorRetryDelay: 30000 // 30 seconds
};
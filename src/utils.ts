import * as dotenv from 'dotenv';
import { Signer, JsonRpcProvider, Wallet, zeroPadValue, parseUnits, formatUnits, ethers } from 'ethers';

// Load environment variables
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const OWNER_ADDRESS = process.env.OWNER_ADDRESS;
const ARBITRUM_SEPOLIA_RPC_URL = process.env.ARBITRUM_SEPOLIA_RPC_URL;
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL;

// Validate essential environment variables
if (!PRIVATE_KEY) {
    throw new Error("Missing PRIVATE_KEY in environment variables.");
}
if (!OWNER_ADDRESS) {
    throw new Error("Missing OWNER_ADDRESS in environment variables.");
}
if (!ARBITRUM_SEPOLIA_RPC_URL) {
    throw new Error("Missing ARBITRUM_SEPOLIA_RPC_URL in environment variables.");
}
if (!BASE_SEPOLIA_RPC_URL) {
    throw new Error("Missing BASE_SEPOLIA_RPC_URL in environment variables.");
}

// Network configuration interface
export interface NetworkConfig {
    name: string;
    rpc: string;
    chainId: number;
    lzEndpoint: string;
    lzEid: number;
}

// Network configurations
export const NETWORKS: Record<string, NetworkConfig> = {
    ArbitrumSepolia: {
        name: "ArbitrumSepolia",
        rpc: ARBITRUM_SEPOLIA_RPC_URL,
        chainId: 421614,
        lzEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f", // Arbitrum sepolia LZ Endpoint
        lzEid: 40231 // Arbitrum sepolia LZ EID
    },
    baseSepolia: {
        name: "baseSepolia",
        rpc: BASE_SEPOLIA_RPC_URL,
        chainId: 84532,
        lzEndpoint: "0x6EDCE65403992e310A62460808c4b910D972f10f", // Base Sepolia LZ Endpoint (same as Arbitrum sepolia for this example, update if different)
        lzEid: 40245 // Base Sepolia LZ EID
    }
};

/**
 * Retrieves the network configuration for a given network name.
 * @param networkName The name of the network (e.g., "Arbitrum sepolia").
 * @returns The network configuration object.
 * @throws Error if the network is not found.
 */
export function getNetworkConfig(networkName: string): NetworkConfig {
    const network = NETWORKS[networkName];
    if (!network) {
        throw new Error(`Network configuration not found for ${networkName}`);
    }
    return network;
}

/**
 * Creates and returns an ethers Wallet instance for a given network.
 * @param networkName The name of the network.
 * @returns A Promise that resolves to an ethers.Wallet instance.
 */
export async function getSigner(networkName: string): Promise<ethers.Wallet> {
    const networkConfig = getNetworkConfig(networkName);
    const provider = new JsonRpcProvider(networkConfig.rpc);
    const wallet = new Wallet(PRIVATE_KEY!, provider);
    return wallet;
}

/**
 * Formats an Ethereum address for LayerZero by padding it to 32 bytes.
 * @param address The Ethereum address string.
 * @returns The LayerZero formatted address string.
 */
export function formatAddressForLayerZero(address: string): string {
    return zeroPadValue(address, 32);
}

// Export necessary functions and constants
export { parseUnits, formatUnits };
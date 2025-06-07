import * as dotenv from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  parseUnits,
  formatUnits,
  Contract,
  ethers,
} from "ethers";
import {
  getSigner,
  getNetworkConfig,
  formatAddressForLayerZero,
  NETWORKS,
  NetworkConfig,
} from "./utils";
import { resolve } from "path";
import { readFile } from "fs/promises";

// Load environment variables at the very top
dotenv.config();

const OWNER_ADDRESS = process.env.OWNER_ADDRESS;
if (!OWNER_ADDRESS) {
  throw new Error(
    "Missing OWNER_ADDRESS in environment variables. Make sure it's set in your .env file."
  );
}

const FACTORY_ADDRESSES: Record<string, string> = {
  ArbitrumSepolia: process.env.ARBITRUM_FACTORY_ADDRESS!,
  baseSepolia: process.env.BASE_FACTORY_ADDRESS!,
  // Add more chains as needed
};

// --- IMPORTANT ---
// Replace these paths with the actual ABI and Bytecode JSON file of your OFT contract (e.g., from MyOFT.sol)
const oftPath = resolve(
  "D:\\Dev\\layerzero-mcp\\artifacts\\MyOFT\\MyOFT.json"
);
// Same here for the factory contract
// This should point to the CREATE2Factory ABI and Bytecode JSON file
const factoryPath = resolve(
  "D:\\Dev\\layerzero-mcp\\artifacts\\factory\\CREATE2Factory.json"
);

// --- IMPORTANT ---

// Dynamically create Zod enums for network names
const networkKeys = Object.keys(NETWORKS) as [string, ...string[]]; // Ensures at least one key
const networkEnum = z.enum(networkKeys);

const server = new McpServer({
  name: "layerzero-oft-mcp",
  description: "MCP Server for deploying and bridging LayerZero OFT tokens",
  version: "0.1.0",
});

// Ensure NETWORKS is available for schema definition
const networkKeysForEnum = Object.keys(NETWORKS) as [string, ...string[]];
if (networkKeysForEnum.length === 0) {
  throw new Error(
    "NETWORKS object is empty. Please define at least one network in utils.ts."
  );
}
const deployAndConfigureOftParams = z.object({
  tokenName: z.string().describe("Name of the token (e.g., MyToken)"),
  tokenSymbol: z.string().describe("Symbol of the token (e.g., MYT)"),
  initialTotalSupply: z
    .string()
    .describe(
      "Total supply of the token in human-readable format (e.g., '1000000')"
    ),
  decimals: z
    .number()
    .int()
    .min(0)
    .max(18)
    .optional()
    .default(18)
    .describe("Number of decimals for the token (default: 18)"),
  targetChains: z
    .array(z.enum(networkKeysForEnum))
    .min(1)
    .describe(
      "List of chain names to deploy and configure the OFT on (e.g., ['ArbitrumSepolia', 'baseSepolia'])"
    ),
  owner: z
    .string()
    .optional()
    .describe(
      "Optional owner address. Defaults to OWNER_ADDRESS from .env if not provided."
    ),
});

server.tool(
  "deploy-and-configure-oft-multichain",
  "Deploys an OFT contract to multiple chains, sets up peer connections, and configures enforced options.",
  deployAndConfigureOftParams.shape,
  async (params: z.infer<typeof deployAndConfigureOftParams>, _extra) => {
    const results: string[] = [];
    const deployedContractsSummary: Array<{
      chainName: string;
      contractAddress: string | null;
      deploymentStatus: string;
      error?: string;
    }> = [];

    // A. Initial Checks & Setup
    results.push("Phase A: Initial Checks & Setup started.");
    const envOwnerAddress = process.env.OWNER_ADDRESS;
    if (!envOwnerAddress) {
      results.push("Error: OWNER_ADDRESS is not set in environment variables.");
      return {
        content: [
          {
            type: "text",
            text: `Error: OWNER_ADDRESS is not set in environment variables.`,
          },
        ],
        isError: true,
      };
    }
    results.push(`OWNER_ADDRESS found: ${envOwnerAddress}`);

    const MyOFT = JSON.parse(await readFile(oftPath, "utf8"));
    const OFT_ABI = MyOFT.abi;
    let OFT_BYTECODE = MyOFT.bytecode.object;

    if (
      OFT_ABI === "ABI_PLACEHOLDER" ||
      OFT_BYTECODE === "BYTECODE_PLACEHOLDER" ||
      OFT_ABI === undefined ||
      OFT_BYTECODE === undefined ||
      OFT_ABI.length === 0 ||
      OFT_BYTECODE.length === 0
    ) {
      results.push(
        "Error: OFT_ABI or OFT_BYTECODE are placeholders. Please replace them in layerzero-mcp.ts."
      );
      return {
        content: [
          {
            type: "text",
            text: `Error: OFT_ABI or OFT_BYTECODE are placeholders. Please replace them in layerzero-mcp.ts.`,
          },
        ],
        isError: true,
      };
    }
    results.push("OFT_ABI and OFT_BYTECODE are not placeholders.");

    if (OFT_BYTECODE && !OFT_BYTECODE.startsWith('0x')) {
      OFT_BYTECODE = '0x' + OFT_BYTECODE;
    }

    if (!params.targetChains || params.targetChains.length === 0) {
      // Zod schema min(1) should prevent this, but good to double check
      results.push("Error: targetChains array is empty.");
      return {
        content: [
          {
            type: "text",
            text: `Error: Failed to Deploy OFT: Error: targetChains array is empty. Please provide at least one target chain.`,
          },
        ],
        isError: true,
      };
    }
    results.push(
      `Target chains for deployment: ${params.targetChains.join(", ")}`
    );

    interface DeployedContractData {
      chainName: string;
      address: string;
      contractInstance: ethers.Contract;
      lzEid: number;
      networkConfig: NetworkConfig;
    }
    const deployedContractsData: DeployedContractData[] = [];
    results.push("Initialization complete.");

    // B. Deployment Phase
    results.push("\nPhase B: Deployment Phase started.");
    const deployOwner = params.owner || envOwnerAddress;
    results.push(`Deployment owner set to: ${deployOwner}`);

    for (const chainName of params.targetChains) {
      results.push(`Attempting deployment on ${chainName}...`);
      try {
        const signer = await getSigner(chainName);
        const networkConfig = getNetworkConfig(chainName);
        results.push(
          `  Signer and network config obtained for ${chainName}. RPC: ${networkConfig.rpc}, LZ EID: ${networkConfig.lzEid}`
        );

        const parsedSupply = ethers.parseUnits(params.initialTotalSupply, 0);
        results.push(
          `  Token: ${params.tokenName} (${params.tokenSymbol}), Supply: ${
            params.initialTotalSupply
          } (parsed: ${parsedSupply.toString()}), Decimals: ${params.decimals}`
        );

        const factoryAddress = FACTORY_ADDRESSES[chainName];
        if (!factoryAddress) {
          throw new Error(`Factory address not defined for ${chainName}`);
        }
        const factoryJSON = JSON.parse(await readFile(factoryPath, "utf8"));
        const factory = new Contract(factoryAddress, factoryJSON.abi, signer);
        results.push("  Contract factory created.");

        // Derive a consistent salt from token name and chain (e.g., to keep same address across chains)
        const salt = ethers.keccak256(
          ethers.toUtf8Bytes(`${params.tokenName}:${params.tokenSymbol}`)
        );

        // Encode constructor args for MyOFT
        const constructorArgs = new ethers.Interface(OFT_ABI).encodeDeploy([
          params.tokenName,
          params.tokenSymbol,
          parsedSupply,
          networkConfig.lzEndpoint,
          deployOwner,
        ]);

        // Combine bytecode + constructor args
        const bytecodeWithArgs = ethers.solidityPacked(
          ["bytes", "bytes"],
          [OFT_BYTECODE, constructorArgs]
        );

        results.push(
          `  Deploying with CREATE2 on ${chainName} using salt: ${salt}`
        );
        const tx = await factory.deploy(bytecodeWithArgs, salt);
        await tx.wait();

        const computedAddress = await factory.lastDeployedAddress();
        results.push(
          `  SUCCESS: Deployed via CREATE2 at computed address: ${computedAddress}`
        );

        const contractInstance = new ethers.Contract(
          computedAddress,
          OFT_ABI,
          signer
        );
        deployedContractsData.push({
          chainName,
          address: computedAddress,
          contractInstance,
          lzEid: networkConfig.lzEid,
          networkConfig,
        });
        deployedContractsSummary.push({
          chainName,
          contractAddress: computedAddress,
          deploymentStatus: "Success",
        });
      } catch (error: any) {
        const constructorArgs = new ethers.Interface(OFT_ABI).encodeDeploy([
          params.tokenName,
          params.tokenSymbol,
          ethers.parseUnits(params.initialTotalSupply, 0),
          getNetworkConfig(chainName).lzEndpoint,
          deployOwner,
        ]);

        // Combine bytecode + constructor args
        const bytecodeWithArgs = ethers.solidityPacked(
          ["bytes", "bytes"],
          [OFT_BYTECODE, constructorArgs]
        );
        const errorMessage = `  FAILURE: Deploying on ${chainName}: ${
          error.message || error.toString()
        }, salt: 
        ${ethers.keccak256(
          ethers.toUtf8Bytes(`${params.tokenName}:${params.tokenSymbol}`)
        )}, bytecode: ${bytecodeWithArgs}`;
        results.push(errorMessage);
        console.error(errorMessage, error);
        deployedContractsSummary.push({
          chainName,
          contractAddress: null,
          deploymentStatus: "Failed",
          error: error.message || error.toString(),
        });
        return {
          content: [
            {
              type: "text",
              text: `Error: Failed to Deploy OFT: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }
    results.push("Deployment Phase completed.");

    // C. Peering Phase
    results.push("\nPhase C: Peering Phase started.");
    const peeringResults: string[] = [];
    if (deployedContractsData.length < 2) {
      const msg =
        "Skipping peering phase: Less than 2 contracts successfully deployed.";
      results.push(msg);
      peeringResults.push(msg);
    } else {
      results.push(
        `Found ${deployedContractsData.length} successfully deployed contracts for peering.`
      );
      for (const contractAData of deployedContractsData) {
        for (const contractBData of deployedContractsData) {
          if (contractAData.chainName === contractBData.chainName) continue;

          const logPrefix = `  Peering ${contractAData.chainName} (EID: ${contractAData.lzEid}) with ${contractBData.chainName} (EID: ${contractBData.lzEid}, Address: ${contractBData.address}):`;
          try {
            const peerAddressBytes32 = formatAddressForLayerZero(
              contractBData.address
            );
            peeringResults.push(
              `${logPrefix} Formatting peer address ${contractBData.address} to ${peerAddressBytes32}`
            );

            const tx = await contractAData.contractInstance.setPeer(
              contractBData.lzEid,
              peerAddressBytes32
            );
            peeringResults.push(
              `${logPrefix} setPeer transaction sent. Waiting for confirmation... TxHash: ${tx.hash}`
            );
            await tx.wait();
            const successMsg = `${logPrefix} SUCCESS.`;
            results.push(successMsg);
            peeringResults.push(successMsg);
          } catch (error: any) {
            const errorMsg = `${logPrefix} FAILURE: ${
              error.message || error.toString()
            }`;
            results.push(errorMsg);
            peeringResults.push(errorMsg);
            console.error(errorMsg, error);
            return {
              content: [
                {
                  type: "text",
                  text: `Error: Failed to Deploy OFT: ${errorMsg}`,
                },
              ],
              isError: true,
            };
          }
        }
      }
    }
    results.push("Peering Phase completed.");

    // D. Enforced Options Phase
    results.push("\nPhase D: Enforced Options Phase started.");
    const enforcedOptionsResults: string[] = [];
    const standardOptionsHex = "0x00030100110100000000000000000000000000030d40"; // 200k gas limit
    results.push(
      `Standard options hex for enforced options: ${standardOptionsHex}`
    );

    if (deployedContractsData.length === 0) {
      const msg =
        "Skipping enforced options phase: No contracts successfully deployed.";
      results.push(msg);
      enforcedOptionsResults.push(msg);
    } else {
      for (const contractData of deployedContractsData) {
        const logPrefix = `  Configuring enforced options on ${contractData.chainName} (Address: ${contractData.address}):`;
        try {
          const optionsToSet: Array<{
            eid: number;
            msgType: number;
            options: string;
          }> = [];
          for (const peerData of deployedContractsData) {
            if (contractData.chainName === peerData.chainName) continue;
            optionsToSet.push({
              eid: peerData.lzEid,
              msgType: 1,
              options: standardOptionsHex,
            });
          }

          if (optionsToSet.length > 0) {
            enforcedOptionsResults.push(
              `${logPrefix} Preparing to set options for ${
                optionsToSet.length
              } peers: ${optionsToSet.map((o) => `EID ${o.eid}`).join(", ")}`
            );
            const tx = await contractData.contractInstance.setEnforcedOptions(
              optionsToSet
            );
            enforcedOptionsResults.push(
              `${logPrefix} setEnforcedOptions transaction sent. Waiting for confirmation... TxHash: ${tx.hash}`
            );
            await tx.wait();
            const successMsg = `${logPrefix} SUCCESS: Set enforced options for ${optionsToSet.length} peers.`;
            results.push(successMsg);
            enforcedOptionsResults.push(successMsg);
          } else {
            const noPeersMsg = `${logPrefix} No peers to set enforced options for.`;
            results.push(noPeersMsg);
            enforcedOptionsResults.push(noPeersMsg);
          }
        } catch (error: any) {
          const errorMsg = `${logPrefix} FAILURE: ${
            error.message || error.toString()
          }`;
          results.push(errorMsg);
          enforcedOptionsResults.push(errorMsg);
          console.error(errorMsg, error);
          return {
            content: [
              {
                type: "text",
                text: `Error: Failed to Deploy OFT: ${errorMsg}`,
              },
            ],
            isError: true,
          };
        }
      }
    }
    results.push("Enforced Options Phase completed.");

    // E. Return Value
    results.push("\nPhase E: Preparing results.");
    let overallStatus = "Deployment and configuration process completed.";
    if (
      deployedContractsSummary.some((s) => s.deploymentStatus === "Failed") ||
      results.some((r) => r.includes("FAILURE"))
    ) {
      overallStatus += " Some errors occurred. Check detailed logs.";
    } else if (deployedContractsData.length === 0) {
      overallStatus = "Deployment failed on all target chains.";
    } else {
      overallStatus =
        "Successfully deployed and configured on all attempted chains where deployment succeeded.";
    }
    results.push(`Overall Status: ${overallStatus}`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              overallStatus,
              deployedContracts: deployedContractsSummary,
              peeringResults,
              enforcedOptionsResults,
              detailedExecutionLog: results,
            },
            null,
            2
          ), // Pretty print JSON
        },
      ],
    };
  }
);

const bridgeOftParams = z.object({
  tokenAddress: z
    .string()
    .describe("The address of the OFT contract on the source chain."),
  amount: z.string().describe("The amount of tokens to bridge (e.g., '100')."),
  fromChain: networkEnum.describe("The source chain name."),
  toChain: networkEnum.describe("The destination chain name."),
  receiverAddress: z
    .string()
    .describe("The address to receive tokens on the destination chain."),
  extraOptions: z
    .string()
    .optional()
    .default("0x")
    .describe("Extra options for LayerZero message execution (default: '0x')."),
});

server.tool(
  "bridge-oft",
  "Bridges OFT tokens from one chain to another using LayerZero.",
  bridgeOftParams.shape,
  async (params: z.infer<typeof bridgeOftParams>) => {
    try {
      const MyOFT = JSON.parse(await readFile(oftPath, "utf8"));
      const OFT_ABI = MyOFT.abi;
      if (
        OFT_ABI === "ABI_PLACEHOLDER" ||
        OFT_ABI === undefined ||
        OFT_ABI.length === 0
      ) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Placeholder ABI detected. Please replace OFT_ABI in layerzero-mcp.ts with your actual contract ABI to interact with existing contracts.",
            },
          ],
          isError: true,
        };
      }
      if (params.fromChain === params.toChain) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Source and destination chains cannot be the same.",
            },
          ],
          isError: true,
        };
      }

      const signer = await getSigner(params.fromChain);
      const fromNetworkConfig = getNetworkConfig(params.fromChain);
      const toNetworkConfig = getNetworkConfig(params.toChain);

      // Assuming 18 decimals for OFT amounts. Make this configurable if needed.
      const amountDecimals = 18;
      const amountBigInt = parseUnits(params.amount, amountDecimals);

      const contract = new Contract(params.tokenAddress, OFT_ABI, signer);

      const formattedReceiverAddress = formatAddressForLayerZero(
        params.receiverAddress
      );

      const sendParam = {
        dstEid: toNetworkConfig.lzEid,
        to: formattedReceiverAddress,
        amountLD: amountBigInt,
        minAmountLD: amountBigInt,
        extraOptions: params.extraOptions || "0x",
        composeMsg: "0x",
        oftCmd: "0x",
      };

      const [nativeFee, lzFee] = await contract.quoteSend(sendParam, false);

      const messagingFee = {
        nativeFee: nativeFee,
        lzTokenFee: 0n,
      };

      const tx = await contract.send(
        sendParam,
        messagingFee,
        await signer.getAddress(),
        { value: nativeFee }
      );

      await tx.wait();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                transactionHash: tx.hash,
                fromChain: params.fromChain,
                toChain: params.toChain,
                amountSent: params.amount,
                sender: await signer.getAddress(),
                receiver: params.receiverAddress,
                estimatedNativeFee: formatUnits(nativeFee),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error: any) {
      console.error("Error bridging OFT:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error: Failed to bridge OFT: ${
              error.message || error.toString()
            }`,
          },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  // console.log("Starting LayerZero OFT MCP Server...");
  // console.log("Available networks:", Object.keys(NETWORKS).join(", "));
  // console.log("Ensure PRIVATE_KEY, OWNER_ADDRESS, and RPC URLs are correctly set in your .env file.");
  // console.log("---");
  // console.log("IMPORTANT: Replace OFT_ABI and OFT_BYTECODE placeholders in layerzero-mcp.ts with your actual contract details before using 'deploy-oft'.");
  // console.log("---");

  const transport = new StdioServerTransport();
  server.connect(transport);
  // console.log("MCP Server listening on stdio.");
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});

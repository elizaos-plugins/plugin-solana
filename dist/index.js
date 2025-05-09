// src/actions/swap.ts
import {
  ModelType,
  composePromptFromState,
  logger as logger2,
  parseJSONObjectFromText
} from "@elizaos/core";
import { Connection, PublicKey as PublicKey2, VersionedTransaction } from "@solana/web3.js";
import BigNumber from "bignumber.js";

// src/constants.ts
var SOLANA_SERVICE_NAME = "solana";
var SOLANA_WALLET_DATA_CACHE_KEY = "solana/walletData";

// src/keypairUtils.ts
import { logger } from "@elizaos/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
async function getWalletKey(runtime, requirePrivateKey = true) {
  if (requirePrivateKey) {
    const privateKeyString = runtime.getSetting("SOLANA_PRIVATE_KEY") ?? runtime.getSetting("WALLET_PRIVATE_KEY");
    if (!privateKeyString) {
      throw new Error("Private key not found in settings");
    }
    try {
      const secretKey = bs58.decode(privateKeyString);
      return { keypair: Keypair.fromSecretKey(secretKey) };
    } catch (e) {
      logger.log("Error decoding base58 private key:", e);
      try {
        logger.log("Try decoding base64 instead");
        const secretKey = Uint8Array.from(Buffer.from(privateKeyString, "base64"));
        return { keypair: Keypair.fromSecretKey(secretKey) };
      } catch (e2) {
        logger.error("Error decoding private key: ", e2);
        throw new Error("Invalid private key format");
      }
    }
  } else {
    const publicKeyString = runtime.getSetting("SOLANA_PUBLIC_KEY") ?? runtime.getSetting("WALLET_PUBLIC_KEY");
    if (!publicKeyString) {
      throw new Error(
        "Solana Public key not found in settings, but plugin was loaded, please set SOLANA_PUBLIC_KEY"
      );
    }
    return { publicKey: new PublicKey(publicKeyString) };
  }
}

// src/actions/swap.ts
async function getTokenDecimals(connection, mintAddress) {
  const mintPublicKey = new PublicKey2(mintAddress);
  const tokenAccountInfo = await connection.getParsedAccountInfo(mintPublicKey);
  if (tokenAccountInfo.value && typeof tokenAccountInfo.value.data === "object" && "parsed" in tokenAccountInfo.value.data) {
    const parsedInfo = tokenAccountInfo.value.data.parsed?.info;
    if (parsedInfo && typeof parsedInfo.decimals === "number") {
      return parsedInfo.decimals;
    }
  }
  throw new Error("Unable to fetch token decimals");
}
async function swapToken(connection, walletPublicKey, inputTokenCA, outputTokenCA, amount) {
  try {
    const decimals = inputTokenCA === process.env.SOL_ADDRESS ? new BigNumber(9) : new BigNumber(await getTokenDecimals(connection, inputTokenCA));
    logger2.log("Decimals:", decimals.toString());
    const amountBN = new BigNumber(amount);
    const adjustedAmount = amountBN.multipliedBy(new BigNumber(10).pow(decimals));
    logger2.log("Fetching quote with params:", {
      inputMint: inputTokenCA,
      outputMint: outputTokenCA,
      amount: adjustedAmount
    });
    const quoteResponse = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputTokenCA}&outputMint=${outputTokenCA}&amount=${adjustedAmount}&dynamicSlippage=true&maxAccounts=64`
    );
    const quoteData = await quoteResponse.json();
    if (!quoteData || quoteData.error) {
      logger2.error("Quote error:", quoteData);
      throw new Error(`Failed to get quote: ${quoteData?.error || "Unknown error"}`);
    }
    const swapRequestBody = {
      quoteResponse: quoteData,
      userPublicKey: walletPublicKey.toBase58(),
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      priorityLevelWithMaxLamports: {
        maxLamports: 4e6,
        priorityLevel: "veryHigh"
      }
    };
    const swapResponse = await fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(swapRequestBody)
    });
    const swapData = await swapResponse.json();
    if (!swapData || !swapData.swapTransaction) {
      logger2.error("Swap error:", swapData);
      throw new Error(
        `Failed to get swap transaction: ${swapData?.error || "No swap transaction returned"}`
      );
    }
    return swapData;
  } catch (error) {
    logger2.error("Error in swapToken:", error);
    throw error;
  }
}
async function getTokenFromWallet(runtime, tokenSymbol) {
  try {
    const solanaService = runtime.getService(SOLANA_SERVICE_NAME);
    if (!solanaService) {
      throw new Error("SolanaService not initialized");
    }
    const walletData = await solanaService.getCachedData();
    if (!walletData) {
      return null;
    }
    const token = walletData.items.find(
      (item) => item.symbol.toLowerCase() === tokenSymbol.toLowerCase()
    );
    return token ? token.address : null;
  } catch (error) {
    logger2.error("Error checking token in wallet:", error);
    return null;
  }
}
var swapTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "inputTokenSymbol": "SOL",
    "outputTokenSymbol": "USDC",
    "inputTokenCA": "So11111111111111111111111111111111111111112",
    "outputTokenCA": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": 1.5
}
\`\`\`

{{recentMessages}}

Given the recent messages and wallet information below:

{{walletInfo}}

Extract the following information about the requested token swap:
- Input token symbol (the token being sold)
- Output token symbol (the token being bought)
- Input token contract address if provided
- Output token contract address if provided
- Amount to swap

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.`;
var executeSwap = {
  name: "SWAP_SOLANA",
  similes: [
    "SWAP_SOL",
    "SWAP_TOKENS_SOLANA",
    "TOKEN_SWAP_SOLANA",
    "TRADE_TOKENS_SOLANA",
    "EXCHANGE_TOKENS_SOLANA"
  ],
  validate: async (runtime, _message) => {
    const solanaService = runtime.getService(SOLANA_SERVICE_NAME);
    return !!solanaService;
  },
  description: "Perform a token swap from one token to another on Solana. Works with SOL and SPL tokens.",
  handler: async (runtime, message, state, _options, callback) => {
    state = await runtime.composeState(message, ["RECENT_MESSAGES"]);
    try {
      const solanaService = runtime.getService(SOLANA_SERVICE_NAME);
      if (!solanaService) {
        throw new Error("SolanaService not initialized");
      }
      const walletData = await solanaService.getCachedData();
      state.values.walletInfo = walletData;
      const swapPrompt = composePromptFromState({
        state,
        template: swapTemplate
      });
      const result = await runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: swapPrompt
      });
      const response = parseJSONObjectFromText(result);
      if (response.inputTokenSymbol?.toUpperCase() === "SOL") {
        response.inputTokenCA = process.env.SOL_ADDRESS;
      }
      if (response.outputTokenSymbol?.toUpperCase() === "SOL") {
        response.outputTokenCA = process.env.SOL_ADDRESS;
      }
      if (!response.inputTokenCA && response.inputTokenSymbol) {
        response.inputTokenCA = await getTokenFromWallet(runtime, response.inputTokenSymbol);
        if (!response.inputTokenCA) {
          callback?.({ text: "Could not find the input token in your wallet" });
          return false;
        }
      }
      if (!response.outputTokenCA && response.outputTokenSymbol) {
        response.outputTokenCA = await getTokenFromWallet(runtime, response.outputTokenSymbol);
        if (!response.outputTokenCA) {
          callback?.({
            text: "Could not find the output token in your wallet"
          });
          return false;
        }
      }
      if (!response.amount) {
        callback?.({ text: "Please specify the amount you want to swap" });
        return false;
      }
      const connection = new Connection(
        runtime.getSetting("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com"
      );
      const { publicKey: walletPublicKey } = await getWalletKey(runtime, false);
      const swapResult = await swapToken(
        connection,
        walletPublicKey,
        response.inputTokenCA,
        response.outputTokenCA,
        response.amount
      );
      const transactionBuf = Buffer.from(swapResult.swapTransaction, "base64");
      const transaction = VersionedTransaction.deserialize(transactionBuf);
      const { keypair } = await getWalletKey(runtime, true);
      if (keypair.publicKey.toBase58() !== walletPublicKey.toBase58()) {
        throw new Error("Generated public key doesn't match expected public key");
      }
      transaction.sign([keypair]);
      const latestBlockhash = await connection.getLatestBlockhash();
      const txid = await connection.sendTransaction(transaction, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: "confirmed"
      });
      const confirmation = await connection.confirmTransaction(
        {
          signature: txid,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        },
        "confirmed"
      );
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err}`);
      }
      callback?.({
        text: `Swap completed successfully! Transaction ID: ${txid}`,
        content: { success: true, txid }
      });
      return true;
    } catch (error) {
      logger2.error("Error during token swap:", error);
      callback?.({
        text: `Swap failed: ${error.message}`,
        content: { error: error.message }
      });
      return false;
    }
  },
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "Swap 0.1 SOL for USDC"
        }
      },
      {
        name: "{{name2}}",
        content: {
          text: "I'll help you swap 0.1 SOL for USDC",
          actions: ["SWAP_SOLANA"]
        }
      }
    ]
  ]
};

// src/actions/transfer.ts
import {
  ModelType as ModelType2,
  composePromptFromState as composePromptFromState2,
  logger as logger3,
  parseJSONObjectFromText as parseJSONObjectFromText2
} from "@elizaos/core";
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import {
  Connection as Connection2,
  PublicKey as PublicKey3,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction as VersionedTransaction2
} from "@solana/web3.js";
function isTransferContent(content) {
  logger3.log("Content for transfer", content);
  if (!content.recipient || typeof content.recipient !== "string" || !content.amount) {
    return false;
  }
  if (content.tokenAddress === "null") {
    content.tokenAddress = null;
  }
  return typeof content.amount === "string" || typeof content.amount === "number";
}
var transferTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example responses:
For SPL tokens:
\`\`\`json
{
    "tokenAddress": "BieefG47jAHCGZBxi2q87RDuHyGZyYC3vAzxpyu8pump",
    "recipient": "9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa",
    "amount": "1000"
}
\`\`\`

For SOL:
\`\`\`json
{
    "tokenAddress": null,
    "recipient": "9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa",
    "amount": 1.5
}
\`\`\`

{{recentMessages}}

Extract the following information about the requested transfer:
- Token contract address (use null for SOL transfers)
- Recipient wallet address
- Amount to transfer
`;
var transfer_default = {
  name: "TRANSFER_SOLANA",
  similes: [
    "TRANSFER_SOL",
    "SEND_TOKEN_SOLANA",
    "TRANSFER_TOKEN_SOLANA",
    "SEND_TOKENS_SOLANA",
    "TRANSFER_TOKENS_SOLANA",
    "SEND_SOL",
    "SEND_TOKEN_SOL",
    "PAY_SOL",
    "PAY_TOKEN_SOL",
    "PAY_TOKENS_SOL",
    "PAY_TOKENS_SOLANA",
    "PAY_SOLANA"
  ],
  validate: async (_runtime, message) => {
    logger3.log("Validating transfer from entity:", message.entityId);
    return true;
  },
  description: "Transfer SOL or SPL tokens to another address on Solana.",
  handler: async (runtime, _message, state, _options, callback) => {
    logger3.log("Starting TRANSFER handler...");
    const transferPrompt = composePromptFromState2({
      state,
      template: transferTemplate
    });
    const result = await runtime.useModel(ModelType2.TEXT_LARGE, {
      prompt: transferPrompt
    });
    const content = parseJSONObjectFromText2(result);
    if (!isTransferContent(content)) {
      if (callback) {
        callback({
          text: "Need a valid recipient address and amount to transfer.",
          content: { error: "Invalid transfer content" }
        });
      }
      return false;
    }
    try {
      const { keypair: senderKeypair } = await getWalletKey(runtime, true);
      const connection = new Connection2(
        runtime.getSetting("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com"
      );
      const recipientPubkey = new PublicKey3(content.recipient);
      let signature;
      if (content.tokenAddress === null) {
        const lamports = Number(content.amount) * 1e9;
        const instruction = SystemProgram.transfer({
          fromPubkey: senderKeypair.publicKey,
          toPubkey: recipientPubkey,
          lamports
        });
        const messageV0 = new TransactionMessage({
          payerKey: senderKeypair.publicKey,
          recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
          instructions: [instruction]
        }).compileToV0Message();
        const transaction = new VersionedTransaction2(messageV0);
        transaction.sign([senderKeypair]);
        signature = await connection.sendTransaction(transaction);
        if (callback) {
          callback({
            text: `Sent ${content.amount} SOL. Transaction hash: ${signature}`,
            content: {
              success: true,
              signature,
              amount: content.amount,
              recipient: content.recipient
            }
          });
        }
      } else {
        const mintPubkey = new PublicKey3(content.tokenAddress);
        const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
        const decimals = mintInfo.value?.data?.parsed?.info?.decimals ?? 9;
        const adjustedAmount = BigInt(Number(content.amount) * 10 ** decimals);
        const senderATA = getAssociatedTokenAddressSync(mintPubkey, senderKeypair.publicKey);
        const recipientATA = getAssociatedTokenAddressSync(mintPubkey, recipientPubkey);
        const instructions = [];
        const recipientATAInfo = await connection.getAccountInfo(recipientATA);
        if (!recipientATAInfo) {
          instructions.push(
            createAssociatedTokenAccountInstruction(
              senderKeypair.publicKey,
              recipientATA,
              recipientPubkey,
              mintPubkey
            )
          );
        }
        instructions.push(
          createTransferInstruction(
            senderATA,
            recipientATA,
            senderKeypair.publicKey,
            adjustedAmount
          )
        );
        const messageV0 = new TransactionMessage({
          payerKey: senderKeypair.publicKey,
          recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
          instructions
        }).compileToV0Message();
        const transaction = new VersionedTransaction2(messageV0);
        transaction.sign([senderKeypair]);
        signature = await connection.sendTransaction(transaction);
        if (callback) {
          callback({
            text: `Sent ${content.amount} tokens to ${content.recipient}
Transaction hash: ${signature}`,
            content: {
              success: true,
              signature,
              amount: content.amount,
              recipient: content.recipient
            }
          });
        }
      }
      return true;
    } catch (error) {
      logger3.error("Error during transfer:", error);
      if (callback) {
        callback({
          text: `Transfer failed: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "Send 1.5 SOL to 9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa"
        }
      },
      {
        name: "{{name2}}",
        content: {
          text: "Sending SOL now...",
          actions: ["TRANSFER_SOLANA"]
        }
      }
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Send 69 $DEGENAI BieefG47jAHCGZBxi2q87RDuHyGZyYC3vAzxpyu8pump to 9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa"
        }
      },
      {
        name: "{{name2}}",
        content: {
          text: "Sending the tokens now...",
          actions: ["TRANSFER_SOLANA"]
        }
      }
    ]
  ]
};

// src/providers/wallet.ts
import BigNumber2 from "bignumber.js";
var walletProvider = {
  name: "solana-wallet",
  description: "your solana wallet information",
  // it's not slow we always have this data
  // but we don't always need this data, let's free up the context
  dynamic: true,
  get: async (runtime, _message, state) => {
    try {
      const portfolioCache = await runtime.getCache(SOLANA_WALLET_DATA_CACHE_KEY);
      if (!portfolioCache) {
        return { data: null, values: {}, text: "" };
      }
      const solanaService = runtime.getService("solana");
      let pubkeyStr = "";
      if (solanaService) {
        pubkeyStr = " (" + solanaService.publicKey.toBase58() + ")";
      }
      const portfolio = portfolioCache;
      const agentName = state?.agentName || runtime.character.name || "The agent";
      const values = {
        total_usd: new BigNumber2(portfolio.totalUsd).toFixed(2),
        total_sol: portfolio.totalSol.toString()
      };
      portfolio.items.forEach((item, index) => {
        if (new BigNumber2(item.uiAmount).isGreaterThan(0)) {
          values[`token_${index}_name`] = item.name;
          values[`token_${index}_symbol`] = item.symbol;
          values[`token_${index}_amount`] = new BigNumber2(item.uiAmount).toFixed(6);
          values[`token_${index}_usd`] = new BigNumber2(item.valueUsd).toFixed(2);
          values[`token_${index}_sol`] = item.valueSol.toString();
        }
      });
      if (portfolio.prices) {
        values.sol_price = new BigNumber2(portfolio.prices.solana.usd).toFixed(2);
        values.btc_price = new BigNumber2(portfolio.prices.bitcoin.usd).toFixed(2);
        values.eth_price = new BigNumber2(portfolio.prices.ethereum.usd).toFixed(2);
      }
      let text = `

${agentName}'s Main Solana Wallet${pubkeyStr}
`;
      text += `Total Value: $${values.total_usd} (${values.total_sol} SOL)

`;
      text += "Token Balances:\n";
      const nonZeroItems = portfolio.items.filter(
        (item) => new BigNumber2(item.uiAmount).isGreaterThan(0)
      );
      if (nonZeroItems.length === 0) {
        text += "No tokens found with non-zero balance\n";
      } else {
        for (const item of nonZeroItems) {
          const valueUsd = new BigNumber2(item.valueUsd).toFixed(2);
          text += `${item.name} (${item.symbol}): ${new BigNumber2(item.uiAmount).toFixed(
            6
          )} ($${valueUsd} | ${item.valueSol} SOL)
`;
        }
      }
      if (portfolio.prices) {
        text += "\nMarket Prices:\n";
        text += `SOL: $${values.sol_price}
`;
        text += `BTC: $${values.btc_price}
`;
        text += `ETH: $${values.eth_price}
`;
      }
      return {
        data: portfolio,
        values,
        text
      };
    } catch (error) {
      console.error("Error in Solana wallet provider:", error);
      return { data: null, values: {}, text: "" };
    }
  }
};

// src/service.ts
import { Service, logger as logger4 } from "@elizaos/core";
import { Connection as Connection3, PublicKey as PublicKey4 } from "@solana/web3.js";
import BigNumber3 from "bignumber.js";
var PROVIDER_CONFIG = {
  BIRDEYE_API: "https://public-api.birdeye.so",
  MAX_RETRIES: 3,
  RETRY_DELAY: 2e3,
  DEFAULT_RPC: "https://api.mainnet-beta.solana.com",
  TOKEN_ADDRESSES: {
    SOL: "So11111111111111111111111111111111111111112",
    BTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
    ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"
  }
};
var SolanaService = class _SolanaService extends Service {
  /**
   * Constructor for creating an instance of the class.
   * @param {IAgentRuntime} runtime - The runtime object that provides access to agent-specific functionality.
   */
  constructor(runtime) {
    super();
    this.runtime = runtime;
    const connection = new Connection3(
      runtime.getSetting("SOLANA_RPC_URL") || PROVIDER_CONFIG.DEFAULT_RPC
    );
    this.connection = connection;
    getWalletKey(runtime, false).then(({ publicKey }) => {
      this.publicKey = publicKey;
    });
  }
  static serviceType = SOLANA_SERVICE_NAME;
  capabilityDescription = "The agent is able to interact with the Solana blockchain, and has access to the wallet data";
  updateInterval = null;
  lastUpdate = 0;
  UPDATE_INTERVAL = 12e4;
  // 2 minutes
  connection;
  publicKey;
  /**
   * Starts the Solana service with the given agent runtime.
   *
   * @param {IAgentRuntime} runtime - The agent runtime to use for the Solana service.
   * @returns {Promise<SolanaService>} The initialized Solana service.
   */
  static async start(runtime) {
    logger4.log("initSolanaService");
    const solanaService = new _SolanaService(runtime);
    logger4.log("SolanaService start");
    if (solanaService.updateInterval) {
      clearInterval(solanaService.updateInterval);
    }
    solanaService.updateInterval = setInterval(async () => {
      logger4.log("Updating wallet data");
      await solanaService.updateWalletData();
    }, solanaService.UPDATE_INTERVAL);
    solanaService.updateWalletData().catch(console.error);
    return solanaService;
  }
  /**
   * Stops the Solana service.
   *
   * @param {IAgentRuntime} runtime - The agent runtime.
   * @returns {Promise<void>} - A promise that resolves once the Solana service has stopped.
   */
  static async stop(runtime) {
    const client = runtime.getService(SOLANA_SERVICE_NAME);
    if (!client) {
      logger4.error("SolanaService not found");
      return;
    }
    await client.stop();
  }
  /**
   * Stops the update interval if it is currently running.
   * @returns {Promise<void>} A Promise that resolves when the update interval is stopped.
   */
  async stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
  /**
   * Fetches data from the provided URL with retry logic.
   * @param {string} url - The URL to fetch data from.
   * @param {RequestInit} [options={}] - The options for the fetch request.
   * @returns {Promise<unknown>} - A promise that resolves to the fetched data.
   */
  async fetchWithRetry(url, options = {}) {
    let lastError;
    for (let i = 0; i < PROVIDER_CONFIG.MAX_RETRIES; i++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            Accept: "application/json",
            "x-chain": "solana",
            "X-API-KEY": this.runtime.getSetting("BIRDEYE_API_KEY"),
            ...options.headers
          }
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }
        return await response.json();
      } catch (error) {
        logger4.error(`Attempt ${i + 1} failed:`, error);
        lastError = error;
        if (i < PROVIDER_CONFIG.MAX_RETRIES - 1) {
          await new Promise((resolve) => setTimeout(resolve, PROVIDER_CONFIG.RETRY_DELAY * 2 ** i));
        }
      }
    }
    throw lastError;
  }
  /**
   * Asynchronously fetches the prices of SOL, BTC, and ETH tokens.
   * Uses cache to store and retrieve prices if available.
   * @returns A Promise that resolves to an object containing the prices of SOL, BTC, and ETH tokens.
   */
  async fetchPrices() {
    const cacheKey = "prices";
    const cachedValue = await this.runtime.getCache(cacheKey);
    if (cachedValue) {
      logger4.log("Cache hit for fetchPrices");
      return cachedValue;
    }
    logger4.log("Cache miss for fetchPrices");
    const { SOL, BTC, ETH } = PROVIDER_CONFIG.TOKEN_ADDRESSES;
    const tokens = [SOL, BTC, ETH];
    const prices = {
      solana: { usd: "0" },
      bitcoin: { usd: "0" },
      ethereum: { usd: "0" }
    };
    for (const token of tokens) {
      const response = await this.fetchWithRetry(
        `${PROVIDER_CONFIG.BIRDEYE_API}/defi/price?address=${token}`
      );
      if (response?.data?.value) {
        const price = response.data.value.toString();
        prices[token === SOL ? "solana" : token === BTC ? "bitcoin" : "ethereum"].usd = price;
      }
    }
    await this.runtime.setCache(cacheKey, prices);
    return prices;
  }
  /**
   * Asynchronously fetches token accounts for a specific owner.
   *
   * @returns {Promise<any[]>} A promise that resolves to an array of token accounts.
   */
  async getTokenAccounts() {
    try {
      const accounts = await this.connection.getParsedTokenAccountsByOwner(this.publicKey, {
        programId: new PublicKey4("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
      });
      return accounts.value;
    } catch (error) {
      logger4.error("Error fetching token accounts:", error);
      return [];
    }
  }
  /**
   * Update wallet data including fetching wallet portfolio information, prices, and caching the data.
   * @param {boolean} [force=false] - Whether to force update the wallet data even if the update interval has not passed
   * @returns {Promise<WalletPortfolio>} The updated wallet portfolio information
   */
  async updateWalletData(force = false) {
    const now = Date.now();
    if (!this.publicKey) {
      logger4.log("solana:::service::updateWalletData - no Public Key yet");
      return {};
    }
    if (!force && now - this.lastUpdate < this.UPDATE_INTERVAL) {
      const cached = await this.getCachedData();
      if (cached) return cached;
    }
    try {
      const birdeyeApiKey = this.runtime.getSetting("BIRDEYE_API_KEY");
      if (birdeyeApiKey) {
        const walletData = await this.fetchWithRetry(
          `${PROVIDER_CONFIG.BIRDEYE_API}/v1/wallet/token_list?wallet=${this.publicKey.toBase58()}`
        );
        if (walletData?.success && walletData?.data) {
          const data = walletData.data;
          const totalUsd = new BigNumber3(data.totalUsd.toString());
          const prices = await this.fetchPrices();
          const solPriceInUSD = new BigNumber3(prices.solana.usd);
          const portfolio2 = {
            totalUsd: totalUsd.toString(),
            totalSol: totalUsd.div(solPriceInUSD).toFixed(6),
            prices,
            lastUpdated: now,
            items: data.items.map((item) => ({
              ...item,
              valueSol: new BigNumber3(item.valueUsd || 0).div(solPriceInUSD).toFixed(6),
              name: item.name || "Unknown",
              symbol: item.symbol || "Unknown",
              priceUsd: item.priceUsd || "0",
              valueUsd: item.valueUsd || "0"
            }))
          };
          await this.runtime.setCache(SOLANA_WALLET_DATA_CACHE_KEY, portfolio2);
          this.lastUpdate = now;
          return portfolio2;
        }
      }
      const accounts = await this.getTokenAccounts();
      const items = accounts.map((acc) => ({
        name: "Unknown",
        address: acc.account.data.parsed.info.mint,
        symbol: "Unknown",
        decimals: acc.account.data.parsed.info.tokenAmount.decimals,
        balance: acc.account.data.parsed.info.tokenAmount.amount,
        uiAmount: acc.account.data.parsed.info.tokenAmount.uiAmount.toString(),
        priceUsd: "0",
        valueUsd: "0",
        valueSol: "0"
      }));
      const portfolio = {
        totalUsd: "0",
        totalSol: "0",
        items
      };
      await this.runtime.setCache(SOLANA_WALLET_DATA_CACHE_KEY, portfolio);
      this.lastUpdate = now;
      return portfolio;
    } catch (error) {
      logger4.error("Error updating wallet data:", error);
      throw error;
    }
  }
  /**
   * Retrieves cached wallet portfolio data from the database adapter.
   * @returns A promise that resolves with the cached WalletPortfolio data if available, otherwise resolves with null.
   */
  async getCachedData() {
    const cachedValue = await this.runtime.getCache(SOLANA_WALLET_DATA_CACHE_KEY);
    if (cachedValue) {
      return cachedValue;
    }
    return null;
  }
  /**
   * Forces an update of the wallet data and returns the updated WalletPortfolio object.
   * @returns A promise that resolves with the updated WalletPortfolio object.
   */
  async forceUpdate() {
    return await this.updateWalletData(true);
  }
  /**
   * Retrieves the public key of the instance.
   *
   * @returns {PublicKey} The public key of the instance.
   */
  getPublicKey() {
    return this.publicKey;
  }
  /**
   * Retrieves the connection object.
   *
   * @returns {Connection} The connection object.
   */
  getConnection() {
    return this.connection;
  }
};

// src/index.ts
var solanaPlugin = {
  name: SOLANA_SERVICE_NAME,
  description: "Solana Plugin for Eliza",
  actions: [transfer_default, executeSwap],
  evaluators: [],
  providers: [walletProvider],
  services: [SolanaService]
};
var index_default = solanaPlugin;
export {
  index_default as default,
  solanaPlugin
};
//# sourceMappingURL=index.js.map
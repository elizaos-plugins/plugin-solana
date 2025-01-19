// src/actions/swap.ts
import {
  composeContext,
  generateObjectDeprecated,
  ModelClass,
  settings as settings2,
  elizaLogger as elizaLogger4
} from "@elizaos/core";
import { Connection as Connection3, VersionedTransaction as VersionedTransaction2 } from "@solana/web3.js";
import BigNumber2 from "bignumber.js";

// src/keypairUtils.ts
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { elizaLogger } from "@elizaos/core";
async function getWalletKey(runtime, requirePrivateKey = true) {
  if (requirePrivateKey) {
    const privateKeyString = runtime.getSetting("SOLANA_PRIVATE_KEY");
    if (!privateKeyString) {
      throw new Error("Private key not found in settings");
    }
    try {
      const secretKey = bs58.decode(privateKeyString);
      return { keypair: Keypair.fromSecretKey(secretKey) };
    } catch (e) {
      elizaLogger.log("Error decoding base58 private key:", e);
      try {
        elizaLogger.log("Try decoding base64 instead");
        const secretKey = Uint8Array.from(
          Buffer.from(privateKeyString, "base64")
        );
        return { keypair: Keypair.fromSecretKey(secretKey) };
      } catch (e2) {
        elizaLogger.error("Error decoding private key: ", e2);
        throw new Error("Invalid private key format");
      }
    }
  } else {
    const publicKeyString = runtime.getSetting("SOLANA_PUBLIC_KEY");
    if (!publicKeyString) {
      throw new Error("Public key not found in settings");
    }
    return { publicKey: new PublicKey(publicKeyString) };
  }
}

// src/providers/wallet.ts
import {
  elizaLogger as elizaLogger2
} from "@elizaos/core";
import { Connection, PublicKey as PublicKey2 } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import NodeCache from "node-cache";
var PROVIDER_CONFIG = {
  BIRDEYE_API: "https://public-api.birdeye.so",
  MAX_RETRIES: 3,
  RETRY_DELAY: 2e3,
  DEFAULT_RPC: "https://api.mainnet-beta.solana.com",
  GRAPHQL_ENDPOINT: "https://graph.codex.io/graphql",
  TOKEN_ADDRESSES: {
    SOL: "So11111111111111111111111111111111111111112",
    BTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
    ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"
  }
};
var WalletProvider = class {
  constructor(connection3, walletPublicKey) {
    this.connection = connection3;
    this.walletPublicKey = walletPublicKey;
    this.cache = new NodeCache({ stdTTL: 300 });
  }
  cache;
  async fetchWithRetry(runtime, url, options = {}) {
    let lastError;
    for (let i = 0; i < PROVIDER_CONFIG.MAX_RETRIES; i++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            Accept: "application/json",
            "x-chain": "solana",
            "X-API-KEY": runtime.getSetting("BIRDEYE_API_KEY", "") || "",
            ...options.headers
          }
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `HTTP error! status: ${response.status}, message: ${errorText}`
          );
        }
        const data = await response.json();
        return data;
      } catch (error) {
        elizaLogger2.error(`Attempt ${i + 1} failed:`, error);
        lastError = error;
        if (i < PROVIDER_CONFIG.MAX_RETRIES - 1) {
          const delay = PROVIDER_CONFIG.RETRY_DELAY * Math.pow(2, i);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
    }
    elizaLogger2.error(
      "All attempts failed. Throwing the last error:",
      lastError
    );
    throw lastError;
  }
  async fetchPortfolioValue(runtime) {
    try {
      const cacheKey = `portfolio-${this.walletPublicKey.toBase58()}`;
      const cachedValue = this.cache.get(cacheKey);
      if (cachedValue) {
        elizaLogger2.log("Cache hit for fetchPortfolioValue");
        return cachedValue;
      }
      elizaLogger2.log("Cache miss for fetchPortfolioValue");
      const birdeyeApiKey = runtime.getSetting("BIRDEYE_API_KEY");
      if (birdeyeApiKey) {
        const walletData = await this.fetchWithRetry(
          runtime,
          `${PROVIDER_CONFIG.BIRDEYE_API}/v1/wallet/token_list?wallet=${this.walletPublicKey.toBase58()}`
        );
        if (walletData?.success && walletData?.data) {
          const data = walletData.data;
          const totalUsd = new BigNumber(data.totalUsd.toString());
          const prices = await this.fetchPrices(runtime);
          const solPriceInUSD = new BigNumber(
            prices.solana.usd.toString()
          );
          const items2 = data.items.map((item) => ({
            ...item,
            valueSol: new BigNumber(item.valueUsd || 0).div(solPriceInUSD).toFixed(6),
            name: item.name || "Unknown",
            symbol: item.symbol || "Unknown",
            priceUsd: item.priceUsd || "0",
            valueUsd: item.valueUsd || "0"
          }));
          const portfolio2 = {
            totalUsd: totalUsd.toString(),
            totalSol: totalUsd.div(solPriceInUSD).toFixed(6),
            items: items2.sort(
              (a, b) => new BigNumber(b.valueUsd).minus(new BigNumber(a.valueUsd)).toNumber()
            )
          };
          this.cache.set(cacheKey, portfolio2);
          return portfolio2;
        }
      }
      const accounts = await this.getTokenAccounts(
        this.walletPublicKey.toBase58()
      );
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
      this.cache.set(cacheKey, portfolio);
      return portfolio;
    } catch (error) {
      elizaLogger2.error("Error fetching portfolio:", error);
      throw error;
    }
  }
  async fetchPortfolioValueCodex(runtime) {
    try {
      const cacheKey = `portfolio-${this.walletPublicKey.toBase58()}`;
      const cachedValue = await this.cache.get(cacheKey);
      if (cachedValue) {
        elizaLogger2.log("Cache hit for fetchPortfolioValue");
        return cachedValue;
      }
      elizaLogger2.log("Cache miss for fetchPortfolioValue");
      const query = `
              query Balances($walletId: String!, $cursor: String) {
                balances(input: { walletId: $walletId, cursor: $cursor }) {
                  cursor
                  items {
                    walletId
                    tokenId
                    balance
                    shiftedBalance
                  }
                }
              }
            `;
      const variables = {
        walletId: `${this.walletPublicKey.toBase58()}:${1399811149}`,
        cursor: null
      };
      const response = await fetch(PROVIDER_CONFIG.GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: runtime.getSetting("CODEX_API_KEY", "") || ""
        },
        body: JSON.stringify({
          query,
          variables
        })
      }).then((res) => res.json());
      const data = response.data?.data?.balances?.items;
      if (!data || data.length === 0) {
        elizaLogger2.error("No portfolio data available", data);
        throw new Error("No portfolio data available");
      }
      const prices = await this.fetchPrices(runtime);
      const solPriceInUSD = new BigNumber(prices.solana.usd.toString());
      const items = data.map((item) => {
        return {
          name: "Unknown",
          address: item.tokenId.split(":")[0],
          symbol: item.tokenId.split(":")[0],
          decimals: 6,
          balance: item.balance,
          uiAmount: item.shiftedBalance.toString(),
          priceUsd: "",
          valueUsd: "",
          valueSol: ""
        };
      });
      const totalUsd = items.reduce(
        (sum, item) => sum.plus(new BigNumber(item.valueUsd)),
        new BigNumber(0)
      );
      const totalSol = totalUsd.div(solPriceInUSD);
      const portfolio = {
        totalUsd: totalUsd.toFixed(6),
        totalSol: totalSol.toFixed(6),
        items: items.sort(
          (a, b) => new BigNumber(b.valueUsd).minus(new BigNumber(a.valueUsd)).toNumber()
        )
      };
      await this.cache.set(cacheKey, portfolio, 60 * 1e3);
      return portfolio;
    } catch (error) {
      elizaLogger2.error("Error fetching portfolio:", error);
      throw error;
    }
  }
  async fetchPrices(runtime) {
    try {
      const cacheKey = "prices";
      const cachedValue = this.cache.get(cacheKey);
      if (cachedValue) {
        elizaLogger2.log("Cache hit for fetchPrices");
        return cachedValue;
      }
      elizaLogger2.log("Cache miss for fetchPrices");
      const { SOL, BTC, ETH } = PROVIDER_CONFIG.TOKEN_ADDRESSES;
      const tokens = [SOL, BTC, ETH];
      const prices = {
        solana: { usd: "0" },
        bitcoin: { usd: "0" },
        ethereum: { usd: "0" }
      };
      for (const token of tokens) {
        const response = await this.fetchWithRetry(
          runtime,
          `${PROVIDER_CONFIG.BIRDEYE_API}/defi/price?address=${token}`,
          {
            headers: {
              "x-chain": "solana"
            }
          }
        );
        if (response?.data?.value) {
          const price = response.data.value.toString();
          prices[token === SOL ? "solana" : token === BTC ? "bitcoin" : "ethereum"].usd = price;
        } else {
          elizaLogger2.warn(
            `No price data available for token: ${token}`
          );
        }
      }
      this.cache.set(cacheKey, prices);
      return prices;
    } catch (error) {
      elizaLogger2.error("Error fetching prices:", error);
      throw error;
    }
  }
  formatPortfolio(runtime, portfolio, prices) {
    let output = `${runtime.character.description}
`;
    output += `Wallet Address: ${this.walletPublicKey.toBase58()}

`;
    const totalUsdFormatted = new BigNumber(portfolio.totalUsd).toFixed(2);
    const totalSolFormatted = portfolio.totalSol;
    output += `Total Value: $${totalUsdFormatted} (${totalSolFormatted} SOL)

`;
    output += "Token Balances:\n";
    const nonZeroItems = portfolio.items.filter(
      (item) => new BigNumber(item.uiAmount).isGreaterThan(0)
    );
    if (nonZeroItems.length === 0) {
      output += "No tokens found with non-zero balance\n";
    } else {
      for (const item of nonZeroItems) {
        const valueUsd = new BigNumber(item.valueUsd).toFixed(2);
        output += `${item.name} (${item.symbol}): ${new BigNumber(
          item.uiAmount
        ).toFixed(6)} ($${valueUsd} | ${item.valueSol} SOL)
`;
      }
    }
    output += "\nMarket Prices:\n";
    output += `SOL: $${new BigNumber(prices.solana.usd).toFixed(2)}
`;
    output += `BTC: $${new BigNumber(prices.bitcoin.usd).toFixed(2)}
`;
    output += `ETH: $${new BigNumber(prices.ethereum.usd).toFixed(2)}
`;
    return output;
  }
  async getFormattedPortfolio(runtime) {
    try {
      const [portfolio, prices] = await Promise.all([
        this.fetchPortfolioValue(runtime),
        this.fetchPrices(runtime)
      ]);
      return this.formatPortfolio(runtime, portfolio, prices);
    } catch (error) {
      elizaLogger2.error("Error generating portfolio report:", error);
      return "Unable to fetch wallet information. Please try again later.";
    }
  }
  async getTokenAccounts(walletAddress) {
    try {
      const accounts = await this.connection.getParsedTokenAccountsByOwner(
        new PublicKey2(walletAddress),
        {
          programId: new PublicKey2(
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          )
        }
      );
      return accounts.value;
    } catch (error) {
      elizaLogger2.error("Error fetching token accounts:", error);
      return [];
    }
  }
};
var walletProvider = {
  get: async (runtime, _message, _state) => {
    try {
      const { publicKey } = await getWalletKey(runtime, false);
      const connection3 = new Connection(
        runtime.getSetting("SOLANA_RPC_URL") || PROVIDER_CONFIG.DEFAULT_RPC
      );
      const provider = new WalletProvider(connection3, publicKey);
      return await provider.getFormattedPortfolio(runtime);
    } catch (error) {
      elizaLogger2.error("Error in wallet provider:", error);
      return null;
    }
  }
};

// src/actions/swapUtils.ts
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  Connection as Connection2,
  PublicKey as PublicKey3,
  VersionedTransaction
} from "@solana/web3.js";
import { settings, elizaLogger as elizaLogger3 } from "@elizaos/core";
var solAddress = settings.SOL_ADDRESS;
var SLIPPAGE = settings.SLIPPAGE;
var connection = new Connection2(
  settings.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
);
async function getTokenDecimals(connection3, mintAddress) {
  const mintPublicKey = new PublicKey3(mintAddress);
  const tokenAccountInfo = await connection3.getParsedAccountInfo(mintPublicKey);
  if (tokenAccountInfo.value && typeof tokenAccountInfo.value.data === "object" && "parsed" in tokenAccountInfo.value.data) {
    const parsedInfo = tokenAccountInfo.value.data.parsed?.info;
    if (parsedInfo && typeof parsedInfo.decimals === "number") {
      return parsedInfo.decimals;
    }
  }
  throw new Error("Unable to fetch token decimals");
}
async function getQuote(connection3, baseToken, outputToken, amount) {
  const decimals = await getTokenDecimals(connection3, baseToken);
  const adjustedAmount = amount * 10 ** decimals;
  const quoteResponse = await fetch(
    `https://quote-api.jup.ag/v6/quote?inputMint=${baseToken}&outputMint=${outputToken}&amount=${adjustedAmount}&slippageBps=50`
  );
  const swapTransaction = await quoteResponse.json();
  const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
  return new Uint8Array(swapTransactionBuf);
}

// src/actions/swap.ts
async function swapToken(connection3, walletPublicKey, inputTokenCA, outputTokenCA, amount) {
  try {
    const decimals = inputTokenCA === settings2.SOL_ADDRESS ? new BigNumber2(9) : new BigNumber2(
      await getTokenDecimals(connection3, inputTokenCA)
    );
    elizaLogger4.log("Decimals:", decimals.toString());
    const amountBN = new BigNumber2(amount);
    const adjustedAmount = amountBN.multipliedBy(
      new BigNumber2(10).pow(decimals)
    );
    elizaLogger4.log("Fetching quote with params:", {
      inputMint: inputTokenCA,
      outputMint: outputTokenCA,
      amount: adjustedAmount
    });
    const quoteResponse = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputTokenCA}&outputMint=${outputTokenCA}&amount=${adjustedAmount}&dynamicSlippage=true&maxAccounts=64`
    );
    const quoteData = await quoteResponse.json();
    if (!quoteData || quoteData.error) {
      elizaLogger4.error("Quote error:", quoteData);
      throw new Error(
        `Failed to get quote: ${quoteData?.error || "Unknown error"}`
      );
    }
    elizaLogger4.log("Quote received:", quoteData);
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
    elizaLogger4.log("Requesting swap with body:", swapRequestBody);
    const swapResponse = await fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(swapRequestBody)
    });
    const swapData = await swapResponse.json();
    if (!swapData || !swapData.swapTransaction) {
      elizaLogger4.error("Swap error:", swapData);
      throw new Error(
        `Failed to get swap transaction: ${swapData?.error || "No swap transaction returned"}`
      );
    }
    elizaLogger4.log("Swap transaction received");
    return swapData;
  } catch (error) {
    elizaLogger4.error("Error in swapToken:", error);
    throw error;
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

Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined. The result should be a valid JSON object with the following schema:
\`\`\`json
{
    "inputTokenSymbol": string | null,
    "outputTokenSymbol": string | null,
    "inputTokenCA": string | null,
    "outputTokenCA": string | null,
    "amount": number | string | null
}
\`\`\``;
async function getTokensInWallet(runtime) {
  const { publicKey } = await getWalletKey(runtime, false);
  const walletProvider2 = new WalletProvider(
    new Connection3("https://api.mainnet-beta.solana.com"),
    publicKey
  );
  const walletInfo = await walletProvider2.fetchPortfolioValue(runtime);
  const items = walletInfo.items;
  return items;
}
async function getTokenFromWallet(runtime, tokenSymbol) {
  try {
    const items = await getTokensInWallet(runtime);
    const token = items.find((item) => item.symbol === tokenSymbol);
    if (token) {
      return token.address;
    } else {
      return null;
    }
  } catch (error) {
    elizaLogger4.error("Error checking token in wallet:", error);
    return null;
  }
}
var executeSwap = {
  name: "EXECUTE_SWAP",
  similes: ["SWAP_TOKENS", "TOKEN_SWAP", "TRADE_TOKENS", "EXCHANGE_TOKENS"],
  validate: async (runtime, message) => {
    elizaLogger4.log("Message:", message);
    return true;
  },
  description: "Perform a token swap.",
  handler: async (runtime, message, state, _options, callback) => {
    if (!state) {
      state = await runtime.composeState(message);
    } else {
      state = await runtime.updateRecentMessageState(state);
    }
    const walletInfo = await walletProvider.get(runtime, message, state);
    state.walletInfo = walletInfo;
    const swapContext = composeContext({
      state,
      template: swapTemplate
    });
    const response = await generateObjectDeprecated({
      runtime,
      context: swapContext,
      modelClass: ModelClass.LARGE
    });
    elizaLogger4.log("Response:", response);
    if (response.inputTokenSymbol?.toUpperCase() === "SOL") {
      response.inputTokenCA = settings2.SOL_ADDRESS;
    }
    if (response.outputTokenSymbol?.toUpperCase() === "SOL") {
      response.outputTokenCA = settings2.SOL_ADDRESS;
    }
    if (!response.inputTokenCA && response.inputTokenSymbol) {
      elizaLogger4.log(
        `Attempting to resolve CA for input token symbol: ${response.inputTokenSymbol}`
      );
      response.inputTokenCA = await getTokenFromWallet(
        runtime,
        response.inputTokenSymbol
      );
      if (response.inputTokenCA) {
        elizaLogger4.log(
          `Resolved inputTokenCA: ${response.inputTokenCA}`
        );
      } else {
        elizaLogger4.log(
          "No contract addresses provided, skipping swap"
        );
        const responseMsg = {
          text: "I need the contract addresses to perform the swap"
        };
        callback?.(responseMsg);
        return true;
      }
    }
    if (!response.outputTokenCA && response.outputTokenSymbol) {
      elizaLogger4.log(
        `Attempting to resolve CA for output token symbol: ${response.outputTokenSymbol}`
      );
      response.outputTokenCA = await getTokenFromWallet(
        runtime,
        response.outputTokenSymbol
      );
      if (response.outputTokenCA) {
        elizaLogger4.log(
          `Resolved outputTokenCA: ${response.outputTokenCA}`
        );
      } else {
        elizaLogger4.log(
          "No contract addresses provided, skipping swap"
        );
        const responseMsg = {
          text: "I need the contract addresses to perform the swap"
        };
        callback?.(responseMsg);
        return true;
      }
    }
    if (!response.amount) {
      elizaLogger4.log("No amount provided, skipping swap");
      const responseMsg = {
        text: "I need the amount to perform the swap"
      };
      callback?.(responseMsg);
      return true;
    }
    if (!response.amount) {
      elizaLogger4.log("Amount is not a number, skipping swap");
      const responseMsg = {
        text: "The amount must be a number"
      };
      callback?.(responseMsg);
      return true;
    }
    try {
      const connection3 = new Connection3(
        "https://api.mainnet-beta.solana.com"
      );
      const { publicKey: walletPublicKey } = await getWalletKey(
        runtime,
        false
      );
      elizaLogger4.log("Wallet Public Key:", walletPublicKey);
      elizaLogger4.log("inputTokenSymbol:", response.inputTokenCA);
      elizaLogger4.log("outputTokenSymbol:", response.outputTokenCA);
      elizaLogger4.log("amount:", response.amount);
      const swapResult = await swapToken(
        connection3,
        walletPublicKey,
        response.inputTokenCA,
        response.outputTokenCA,
        response.amount
      );
      elizaLogger4.log("Deserializing transaction...");
      const transactionBuf = Buffer.from(
        swapResult.swapTransaction,
        "base64"
      );
      const transaction = VersionedTransaction2.deserialize(transactionBuf);
      elizaLogger4.log("Preparing to sign transaction...");
      elizaLogger4.log("Creating keypair...");
      const { keypair } = await getWalletKey(runtime, true);
      if (keypair.publicKey.toBase58() !== walletPublicKey.toBase58()) {
        throw new Error(
          "Generated public key doesn't match expected public key"
        );
      }
      elizaLogger4.log("Signing transaction...");
      transaction.sign([keypair]);
      elizaLogger4.log("Sending transaction...");
      const latestBlockhash = await connection3.getLatestBlockhash();
      const txid = await connection3.sendTransaction(transaction, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: "confirmed"
      });
      elizaLogger4.log("Transaction sent:", txid);
      const confirmation = await connection3.confirmTransaction(
        {
          signature: txid,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        },
        "confirmed"
      );
      if (confirmation.value.err) {
        throw new Error(
          `Transaction failed: ${confirmation.value.err}`
        );
      }
      if (confirmation.value.err) {
        throw new Error(
          `Transaction failed: ${confirmation.value.err}`
        );
      }
      elizaLogger4.log("Swap completed successfully!");
      elizaLogger4.log(`Transaction ID: ${txid}`);
      const responseMsg = {
        text: `Swap completed successfully! Transaction ID: ${txid}`
      };
      callback?.(responseMsg);
      return true;
    } catch (error) {
      elizaLogger4.error("Error during token swap:", error);
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          inputTokenSymbol: "SOL",
          outputTokenSymbol: "USDC",
          amount: 0.1
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Swapping 0.1 SOL for USDC...",
          action: "TOKEN_SWAP"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Swap completed successfully! Transaction ID: ..."
        }
      }
    ]
    // Add more examples as needed
  ]
};

// src/actions/takeOrder.ts
import {
  ModelClass as ModelClass2,
  composeContext as composeContext2,
  generateText
} from "@elizaos/core";
var take_order = {
  name: "TAKE_ORDER",
  similes: ["BUY_ORDER", "PLACE_ORDER"],
  description: "Records a buy order based on the user's conviction level.",
  examples: [],
  validate: async (runtime, message) => {
    const text = message.content.text;
    const tickerRegex = /\b[A-Z]{1,5}\b/g;
    return tickerRegex.test(text);
  },
  handler: async (runtime, message) => {
    const _text = message.content.text;
    const userId = message.userId;
    const template = `

// CLAUDE TODO: Put the usual conversation context here

Ticker is: {{ticker}}
Contract address is: {{contractAddress}}

Determine if the user is trying to shill the ticker. if they are, respond with empty conviction, ticker and contractAddress.

// CLAUDE TODO: output a JSON block with the following fields:
// - reasoning: string
// - conviction: negative, low, medium, high
// - ticker: string (extract from CA so we have context)
// - contractAddress: string
`;
    let ticker, contractAddress;
    if (!ticker || !contractAddress) {
      return {
        text: "Ticker and CA?"
      };
    }
    const state = await runtime.composeState(message);
    const context = composeContext2({
      state: {
        ...state,
        ticker,
        contractAddress
      },
      template
    });
    const convictionResponse = await generateText({
      runtime,
      context,
      modelClass: ModelClass2.LARGE
    });
    const convictionResponseJson = JSON.parse(convictionResponse);
    const conviction = convictionResponseJson.conviction;
    let buyAmount = 0;
    if (conviction === "low") {
      buyAmount = 20;
    } else if (conviction === "medium") {
      buyAmount = 50;
    } else if (conviction === "high") {
      buyAmount = 100;
    }
    const currentPrice = 100;
    const order = {
      userId,
      ticker: ticker || "",
      contractAddress,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      buyAmount,
      price: currentPrice
    };
    const orderBookPath = runtime.getSetting("orderBookPath") ?? "solana/orderBook.json";
    const orderBook = [];
    const cachedOrderBook = await runtime.cacheManager.get(orderBookPath);
    if (cachedOrderBook) {
      orderBook.push(...cachedOrderBook);
    }
    orderBook.push(order);
    await runtime.cacheManager.set(orderBookPath, orderBook);
    return {
      text: `Recorded a ${conviction} conviction buy order for ${ticker} (${contractAddress}) with an amount of ${buyAmount} at the price of ${currentPrice}.`
    };
  }
};
var takeOrder_default = take_order;

// src/actions/pumpfun.ts
import { AnchorProvider } from "@coral-xyz/anchor";
import { Wallet } from "@coral-xyz/anchor";
import { generateImage } from "@elizaos/core";
import { Connection as Connection4, Keypair as Keypair3 } from "@solana/web3.js";
import { PumpFunSDK } from "pumpdotfun-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  settings as settings3,
  ModelClass as ModelClass3,
  generateObjectDeprecated as generateObjectDeprecated2,
  composeContext as composeContext3,
  elizaLogger as elizaLogger5
} from "@elizaos/core";
import * as fs from "fs";
import * as path from "path";
function isCreateAndBuyContent(runtime, content) {
  elizaLogger5.log("Content for create & buy", content);
  return typeof content.tokenMetadata === "object" && content.tokenMetadata !== null && typeof content.tokenMetadata.name === "string" && typeof content.tokenMetadata.symbol === "string" && typeof content.tokenMetadata.description === "string" && typeof content.tokenMetadata.image_description === "string" && (typeof content.buyAmountSol === "string" || typeof content.buyAmountSol === "number");
}
var createAndBuyToken = async ({
  deployer,
  mint,
  tokenMetadata,
  buyAmountSol,
  priorityFee,
  allowOffCurve,
  commitment = "confirmed",
  sdk,
  connection: connection3,
  slippage
}) => {
  const createResults = await sdk.createAndBuy(
    deployer,
    mint,
    tokenMetadata,
    buyAmountSol,
    BigInt(slippage),
    priorityFee,
    commitment
  );
  elizaLogger5.log("Create Results: ", createResults);
  if (createResults.success) {
    elizaLogger5.log(
      "Success:",
      `https://pump.fun/${mint.publicKey.toBase58()}`
    );
    const ata = getAssociatedTokenAddressSync(
      mint.publicKey,
      deployer.publicKey,
      allowOffCurve
    );
    const balance = await connection3.getTokenAccountBalance(
      ata,
      "processed"
    );
    const amount = balance.value.uiAmount;
    if (amount === null) {
      elizaLogger5.log(
        `${deployer.publicKey.toBase58()}:`,
        "No Account Found"
      );
    } else {
      elizaLogger5.log(`${deployer.publicKey.toBase58()}:`, amount);
    }
    return {
      success: true,
      ca: mint.publicKey.toBase58(),
      creator: deployer.publicKey.toBase58()
    };
  } else {
    elizaLogger5.log("Create and Buy failed");
    return {
      success: false,
      ca: mint.publicKey.toBase58(),
      error: createResults.error || "Transaction failed"
    };
  }
};
var promptConfirmation = async () => {
  return true;
};
var pumpfunTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "tokenMetadata": {
        "name": "Test Token",
        "symbol": "TEST",
        "description": "A test token",
        "image_description": "create an image of a rabbit"
    },
    "buyAmountSol": "0.00069"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract or generate (come up with if not included) the following information about the requested token creation:
- Token name
- Token symbol
- Token description
- Token image description
- Amount of SOL to buy

Respond with a JSON markdown block containing only the extracted values.`;
var pumpfun_default = {
  name: "CREATE_AND_BUY_TOKEN",
  similes: ["CREATE_AND_PURCHASE_TOKEN", "DEPLOY_AND_BUY_TOKEN"],
  validate: async (_runtime, _message) => {
    return true;
  },
  description: "Create a new token and buy a specified amount using SOL. Requires deployer private key, token metadata, buy amount in SOL, priority fee, and allowOffCurve flag.",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger5.log("Starting CREATE_AND_BUY_TOKEN handler...");
    if (!state) {
      state = await runtime.composeState(message);
    } else {
      state = await runtime.updateRecentMessageState(state);
    }
    const walletInfo = await walletProvider.get(runtime, message, state);
    state.walletInfo = walletInfo;
    const pumpContext = composeContext3({
      state,
      template: pumpfunTemplate
    });
    const content = await generateObjectDeprecated2({
      runtime,
      context: pumpContext,
      modelClass: ModelClass3.LARGE
    });
    if (!isCreateAndBuyContent(runtime, content)) {
      elizaLogger5.error(
        "Invalid content for CREATE_AND_BUY_TOKEN action."
      );
      return false;
    }
    const { tokenMetadata, buyAmountSol } = content;
    const imageResult = await generateImage(
      {
        prompt: `logo for ${tokenMetadata.name} (${tokenMetadata.symbol}) token - ${tokenMetadata.description}`,
        width: 256,
        height: 256,
        count: 1
      },
      runtime
    );
    tokenMetadata.image_description = imageResult.data[0].replace(
      /^data:image\/[a-z]+;base64,/,
      ""
    );
    const base64Data = tokenMetadata.image_description;
    const outputPath = path.join(
      process.cwd(),
      `generated_image_${Date.now()}.txt`
    );
    fs.writeFileSync(outputPath, base64Data);
    elizaLogger5.log(`Base64 data saved to: ${outputPath}`);
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: "image/png" });
    const fullTokenMetadata = {
      name: tokenMetadata.name,
      symbol: tokenMetadata.symbol,
      description: tokenMetadata.description,
      file: blob
    };
    const priorityFee = {
      unitLimit: 1e8,
      unitPrice: 1e5
    };
    const slippage = "2000";
    try {
      const { keypair: deployerKeypair } = await getWalletKey(
        runtime,
        true
      );
      const mintKeypair = Keypair3.generate();
      elizaLogger5.log(
        `Generated mint address: ${mintKeypair.publicKey.toBase58()}`
      );
      const connection3 = new Connection4(settings3.SOLANA_RPC_URL, {
        commitment: "confirmed",
        confirmTransactionInitialTimeout: 5e5,
        // 120 seconds
        wsEndpoint: settings3.SOLANA_RPC_URL.replace("https", "wss")
      });
      const wallet = new Wallet(deployerKeypair);
      const provider = new AnchorProvider(connection3, wallet, {
        commitment: "confirmed"
      });
      const sdk = new PumpFunSDK(provider);
      const createAndBuyConfirmation = await promptConfirmation();
      if (!createAndBuyConfirmation) {
        elizaLogger5.log("Create and buy token canceled by user");
        return false;
      }
      const lamports = Math.floor(Number(buyAmountSol) * 1e9);
      elizaLogger5.log("Executing create and buy transaction...");
      const result = await createAndBuyToken({
        deployer: deployerKeypair,
        mint: mintKeypair,
        tokenMetadata: fullTokenMetadata,
        buyAmountSol: BigInt(lamports),
        priorityFee,
        allowOffCurve: false,
        sdk,
        connection: connection3,
        slippage
      });
      if (callback) {
        if (result.success) {
          callback({
            text: `Token ${tokenMetadata.name} (${tokenMetadata.symbol}) created successfully!
Contract Address: ${result.ca}
Creator: ${result.creator}
View at: https://pump.fun/${result.ca}`,
            content: {
              tokenInfo: {
                symbol: tokenMetadata.symbol,
                address: result.ca,
                creator: result.creator,
                name: tokenMetadata.name,
                description: tokenMetadata.description,
                timestamp: Date.now()
              }
            }
          });
        } else {
          callback({
            text: `Failed to create token: ${result.error}
Attempted mint address: ${result.ca}`,
            content: {
              error: result.error,
              mintAddress: result.ca
            }
          });
        }
      }
      const successMessage = `Token created and purchased successfully! View at: https://pump.fun/${mintKeypair.publicKey.toBase58()}`;
      elizaLogger5.log(successMessage);
      return result.success;
    } catch (error) {
      if (callback) {
        callback({
          text: `Error during token creation: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Create a new token called GLITCHIZA with symbol GLITCHIZA and generate a description about it on pump.fun. Also come up with a description for it to use for image generation .buy 0.00069 SOL worth."
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Token GLITCHIZA (GLITCHIZA) created successfully on pump.fun!\nContract Address: 3kD5DN4bbA3nykb1abjS66VF7cYZkKdirX8bZ6ShJjBB\nCreator: 9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa\nView at: https://pump.fun/EugPwuZ8oUMWsYHeBGERWvELfLGFmA1taDtmY8uMeX6r",
          action: "CREATE_AND_BUY_TOKEN",
          content: {
            tokenInfo: {
              symbol: "GLITCHIZA",
              address: "EugPwuZ8oUMWsYHeBGERWvELfLGFmA1taDtmY8uMeX6r",
              creator: "9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa",
              name: "GLITCHIZA",
              description: "A GLITCHIZA token"
            }
          }
        }
      }
    ]
  ]
};

// src/actions/fomo.ts
import { generateImage as generateImage2, elizaLogger as elizaLogger6 } from "@elizaos/core";
import {
  Connection as Connection5,
  Keypair as Keypair4,
  VersionedTransaction as VersionedTransaction3
} from "@solana/web3.js";
import { Fomo } from "fomo-sdk-solana";
import { getAssociatedTokenAddressSync as getAssociatedTokenAddressSync2 } from "@solana/spl-token";
import bs582 from "bs58";
import {
  settings as settings4,
  ModelClass as ModelClass4,
  generateObject,
  composeContext as composeContext4
} from "@elizaos/core";
function isCreateAndBuyContentForFomo(content) {
  elizaLogger6.log("Content for create & buy", content);
  return typeof content.tokenMetadata === "object" && content.tokenMetadata !== null && typeof content.tokenMetadata.name === "string" && typeof content.tokenMetadata.symbol === "string" && typeof content.tokenMetadata.description === "string" && typeof content.tokenMetadata.image_description === "string" && (typeof content.buyAmountSol === "string" || typeof content.buyAmountSol === "number") && typeof content.requiredLiquidity === "number";
}
var createAndBuyToken2 = async ({
  deployer,
  mint,
  tokenMetadata,
  buyAmountSol,
  priorityFee,
  requiredLiquidity = 85,
  allowOffCurve,
  commitment = "confirmed",
  fomo,
  connection: connection3
}) => {
  const { transaction: versionedTx } = await fomo.createToken(
    deployer.publicKey,
    tokenMetadata.name,
    tokenMetadata.symbol,
    tokenMetadata.uri,
    priorityFee,
    bs582.encode(mint.secretKey),
    requiredLiquidity,
    Number(buyAmountSol) / 10 ** 9
  );
  const { blockhash, lastValidBlockHeight } = await connection3.getLatestBlockhash();
  versionedTx.message.recentBlockhash = blockhash;
  versionedTx.sign([mint]);
  const serializedTransaction = versionedTx.serialize();
  const serializedTransactionBase64 = Buffer.from(
    serializedTransaction
  ).toString("base64");
  const deserializedTx = VersionedTransaction3.deserialize(
    Buffer.from(serializedTransactionBase64, "base64")
  );
  const txid = await connection3.sendTransaction(deserializedTx, {
    skipPreflight: false,
    maxRetries: 3,
    preflightCommitment: "confirmed"
  });
  elizaLogger6.log("Transaction sent:", txid);
  const confirmation = await connection3.confirmTransaction(
    {
      signature: txid,
      blockhash,
      lastValidBlockHeight
    },
    commitment
  );
  if (!confirmation.value.err) {
    elizaLogger6.log(
      "Success:",
      `https://fomo.fund/token/${mint.publicKey.toBase58()}`
    );
    const ata = getAssociatedTokenAddressSync2(
      mint.publicKey,
      deployer.publicKey,
      allowOffCurve
    );
    const balance = await connection3.getTokenAccountBalance(
      ata,
      "processed"
    );
    const amount = balance.value.uiAmount;
    if (amount === null) {
      elizaLogger6.log(
        `${deployer.publicKey.toBase58()}:`,
        "No Account Found"
      );
    } else {
      elizaLogger6.log(`${deployer.publicKey.toBase58()}:`, amount);
    }
    return {
      success: true,
      ca: mint.publicKey.toBase58(),
      creator: deployer.publicKey.toBase58()
    };
  } else {
    elizaLogger6.log("Create and Buy failed");
    return {
      success: false,
      ca: mint.publicKey.toBase58(),
      error: confirmation.value.err || "Transaction failed"
    };
  }
};
var promptConfirmation2 = async () => {
  return true;
};
var fomoTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "tokenMetadata": {
        "name": "Test Token",
        "symbol": "TEST",
        "description": "A test token",
        "image_description": "create an image of a rabbit"
    },
    "buyAmountSol": "0.00069",
    "requiredLiquidity": "85"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract or generate (come up with if not included) the following information about the requested token creation:
- Token name
- Token symbol
- Token description
- Token image description
- Amount of SOL to buy

Respond with a JSON markdown block containing only the extracted values.`;
var fomo_default = {
  name: "CREATE_AND_BUY_TOKEN",
  similes: ["CREATE_AND_PURCHASE_TOKEN", "DEPLOY_AND_BUY_TOKEN"],
  validate: async (_runtime, _message) => {
    return true;
  },
  description: "Create a new token and buy a specified amount using SOL. Requires deployer private key, token metadata, buy amount in SOL, priority fee, and allowOffCurve flag.",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger6.log("Starting CREATE_AND_BUY_TOKEN handler...");
    if (!state) {
      state = await runtime.composeState(message);
    } else {
      state = await runtime.updateRecentMessageState(state);
    }
    const walletInfo = await walletProvider.get(runtime, message, state);
    state.walletInfo = walletInfo;
    const pumpContext = composeContext4({
      state,
      template: fomoTemplate
    });
    const content = await generateObject({
      runtime,
      context: pumpContext,
      modelClass: ModelClass4.LARGE
    });
    if (!isCreateAndBuyContentForFomo(content)) {
      elizaLogger6.error(
        "Invalid content for CREATE_AND_BUY_TOKEN action."
      );
      return false;
    }
    const { tokenMetadata, buyAmountSol, requiredLiquidity } = content;
    const imageResult = await generateImage2(
      {
        prompt: `logo for ${tokenMetadata.name} (${tokenMetadata.symbol}) token - ${tokenMetadata.description}`,
        width: 256,
        height: 256,
        count: 1
      },
      runtime
    );
    const imageBuffer = Buffer.from(imageResult.data[0], "base64");
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: "image/png" });
    formData.append("file", blob, `${tokenMetadata.name}.png`);
    formData.append("name", tokenMetadata.name);
    formData.append("symbol", tokenMetadata.symbol);
    formData.append("description", tokenMetadata.description);
    const metadataResponse = await fetch("https://pump.fun/api/ipfs", {
      method: "POST",
      body: formData
    });
    const metadataResponseJSON = await metadataResponse.json();
    const fullTokenMetadata = {
      name: tokenMetadata.name,
      symbol: tokenMetadata.symbol,
      uri: metadataResponseJSON.metadataUri
    };
    const priorityFee = {
      unitLimit: 1e8,
      unitPrice: 1e5
    };
    const slippage = "2000";
    try {
      const privateKeyString = runtime.getSetting("SOLANA_PRIVATE_KEY");
      const secretKey = bs582.decode(privateKeyString);
      const deployerKeypair = Keypair4.fromSecretKey(secretKey);
      const mintKeypair = Keypair4.generate();
      elizaLogger6.log(
        `Generated mint address: ${mintKeypair.publicKey.toBase58()}`
      );
      const connection3 = new Connection5(settings4.SOLANA_RPC_URL, {
        commitment: "confirmed",
        confirmTransactionInitialTimeout: 5e5,
        // 120 seconds
        wsEndpoint: settings4.SOLANA_RPC_URL.replace("https", "wss")
      });
      const sdk = new Fomo(connection3, "devnet", deployerKeypair);
      const createAndBuyConfirmation = await promptConfirmation2();
      if (!createAndBuyConfirmation) {
        elizaLogger6.log("Create and buy token canceled by user");
        return false;
      }
      const lamports = Math.floor(Number(buyAmountSol) * 1e9);
      elizaLogger6.log("Executing create and buy transaction...");
      const result = await createAndBuyToken2({
        deployer: deployerKeypair,
        mint: mintKeypair,
        tokenMetadata: fullTokenMetadata,
        buyAmountSol: BigInt(lamports),
        priorityFee: priorityFee.unitPrice,
        requiredLiquidity: Number(requiredLiquidity),
        allowOffCurve: false,
        fomo: sdk,
        connection: connection3,
        slippage
      });
      if (callback) {
        if (result.success) {
          callback({
            text: `Token ${tokenMetadata.name} (${tokenMetadata.symbol}) created successfully!
URL: https://fomo.fund/token/${result.ca}
Creator: ${result.creator}
View at: https://fomo.fund/token/${result.ca}`,
            content: {
              tokenInfo: {
                symbol: tokenMetadata.symbol,
                address: result.ca,
                creator: result.creator,
                name: tokenMetadata.name,
                description: tokenMetadata.description,
                timestamp: Date.now()
              }
            }
          });
        } else {
          callback({
            text: `Failed to create token: ${result.error}
Attempted mint address: ${result.ca}`,
            content: {
              error: result.error,
              mintAddress: result.ca
            }
          });
        }
      }
      const successMessage = `Token created and purchased successfully! View at: https://fomo.fund/token/${mintKeypair.publicKey.toBase58()}`;
      elizaLogger6.log(successMessage);
      return result.success;
    } catch (error) {
      if (callback) {
        callback({
          text: `Error during token creation: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Create a new token called GLITCHIZA with symbol GLITCHIZA and generate a description about it on fomo.fund. Also come up with a description for it to use for image generation .buy 0.00069 SOL worth."
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Token GLITCHIZA (GLITCHIZA) created successfully on fomo.fund!\nURL: https://fomo.fund/token/673247855e8012181f941f84\nCreator: Anonymous\nView at: https://fomo.fund/token/673247855e8012181f941f84",
          action: "CREATE_AND_BUY_TOKEN",
          content: {
            tokenInfo: {
              symbol: "GLITCHIZA",
              address: "EugPwuZ8oUMWsYHeBGERWvELfLGFmA1taDtmY8uMeX6r",
              creator: "9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa",
              name: "GLITCHIZA",
              description: "A GLITCHIZA token"
            }
          }
        }
      }
    ]
  ]
};

// src/actions/swapDao.ts
import {
  elizaLogger as elizaLogger7
} from "@elizaos/core";
import { Connection as Connection6, PublicKey as PublicKey7, Transaction } from "@solana/web3.js";
async function invokeSwapDao(connection3, authority, statePDA, walletPDA, instructionData) {
  const discriminator = new Uint8Array([
    25,
    143,
    207,
    190,
    174,
    228,
    130,
    107
  ]);
  const combinedData = new Uint8Array(
    discriminator.length + instructionData.length
  );
  combinedData.set(discriminator, 0);
  combinedData.set(instructionData, discriminator.length);
  const transaction = new Transaction().add({
    programId: new PublicKey7("PROGRAM_ID"),
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: statePDA, isSigner: false, isWritable: true },
      { pubkey: walletPDA, isSigner: false, isWritable: true }
    ],
    data: Buffer.from(combinedData)
  });
  const signature = await connection3.sendTransaction(transaction, [
    authority
  ]);
  await connection3.confirmTransaction(signature);
  return signature;
}
async function promptConfirmation3() {
  const confirmSwap = window.confirm("Confirm the token swap?");
  return confirmSwap;
}
var executeSwapForDAO = {
  name: "EXECUTE_SWAP_DAO",
  similes: ["SWAP_TOKENS_DAO", "TOKEN_SWAP_DAO"],
  validate: async (runtime, message) => {
    elizaLogger7.log("Message:", message);
    return true;
  },
  description: "Perform a DAO token swap using execute_invoke.",
  handler: async (runtime, message) => {
    const { inputToken, outputToken, amount } = message.content;
    try {
      const connection3 = new Connection6(
        runtime.getSetting("SOLANA_RPC_URL")
      );
      const { keypair: authority } = await getWalletKey(runtime, true);
      const daoMint = new PublicKey7(runtime.getSetting("DAO_MINT"));
      const [statePDA] = await PublicKey7.findProgramAddress(
        [Buffer.from("state"), daoMint.toBuffer()],
        authority.publicKey
      );
      const [walletPDA] = await PublicKey7.findProgramAddress(
        [Buffer.from("wallet"), daoMint.toBuffer()],
        authority.publicKey
      );
      const quoteData = await getQuote(
        connection3,
        inputToken,
        outputToken,
        amount
      );
      elizaLogger7.log("Swap Quote:", quoteData);
      const confirmSwap = await promptConfirmation3();
      if (!confirmSwap) {
        elizaLogger7.log("Swap canceled by user");
        return false;
      }
      const instructionData = Buffer.from(
        JSON.stringify({
          quote: quoteData.data,
          userPublicKey: authority.publicKey.toString(),
          wrapAndUnwrapSol: true
        })
      );
      const txid = await invokeSwapDao(
        connection3,
        authority,
        statePDA,
        walletPDA,
        instructionData
      );
      elizaLogger7.log("DAO Swap completed successfully!");
      elizaLogger7.log(`Transaction ID: ${txid}`);
      return true;
    } catch (error) {
      elizaLogger7.error("Error during DAO token swap:", error);
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          inputTokenSymbol: "SOL",
          outputTokenSymbol: "USDC",
          inputToken: "So11111111111111111111111111111111111111112",
          outputToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amount: 0.1
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Swapping 0.1 SOL for USDC using DAO...",
          action: "TOKEN_SWAP_DAO"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "DAO Swap completed successfully! Transaction ID: ..."
        }
      }
    ]
  ]
};

// src/actions/transfer.ts
import {
  getAssociatedTokenAddressSync as getAssociatedTokenAddressSync3,
  createTransferInstruction
} from "@solana/spl-token";
import { elizaLogger as elizaLogger8, settings as settings5 } from "@elizaos/core";
import {
  Connection as Connection7,
  PublicKey as PublicKey8,
  TransactionMessage,
  VersionedTransaction as VersionedTransaction4
} from "@solana/web3.js";
import {
  ModelClass as ModelClass5
} from "@elizaos/core";
import { composeContext as composeContext5 } from "@elizaos/core";
import { generateObjectDeprecated as generateObjectDeprecated3 } from "@elizaos/core";
function isTransferContent(runtime, content) {
  elizaLogger8.log("Content for transfer", content);
  return typeof content.tokenAddress === "string" && typeof content.recipient === "string" && (typeof content.amount === "string" || typeof content.amount === "number");
}
var transferTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "tokenAddress": "BieefG47jAHCGZBxi2q87RDuHyGZyYC3vAzxpyu8pump",
    "recipient": "9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa",
    "amount": "1000"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested token transfer:
- Token contract address
- Recipient wallet address
- Amount to transfer

Respond with a JSON markdown block containing only the extracted values.`;
var transfer_default = {
  name: "SEND_TOKEN",
  similes: [
    "TRANSFER_TOKEN",
    "TRANSFER_TOKENS",
    "SEND_TOKENS",
    "SEND_SOL",
    "PAY"
  ],
  validate: async (runtime, message) => {
    elizaLogger8.log("Validating transfer from user:", message.userId);
    return false;
  },
  description: "Transfer tokens from the agent's wallet to another address",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger8.log("Starting SEND_TOKEN handler...");
    if (!state) {
      state = await runtime.composeState(message);
    } else {
      state = await runtime.updateRecentMessageState(state);
    }
    const transferContext = composeContext5({
      state,
      template: transferTemplate
    });
    const content = await generateObjectDeprecated3({
      runtime,
      context: transferContext,
      modelClass: ModelClass5.LARGE
    });
    if (!isTransferContent(runtime, content)) {
      elizaLogger8.error("Invalid content for TRANSFER_TOKEN action.");
      if (callback) {
        callback({
          text: "Unable to process transfer request. Invalid content provided.",
          content: { error: "Invalid transfer content" }
        });
      }
      return false;
    }
    try {
      const { keypair: senderKeypair } = await getWalletKey(
        runtime,
        true
      );
      const connection3 = new Connection7(settings5.SOLANA_RPC_URL);
      const mintPubkey = new PublicKey8(content.tokenAddress);
      const recipientPubkey = new PublicKey8(content.recipient);
      const mintInfo = await connection3.getParsedAccountInfo(mintPubkey);
      const decimals = mintInfo.value?.data?.parsed?.info?.decimals ?? 9;
      const adjustedAmount = BigInt(
        Number(content.amount) * Math.pow(10, decimals)
      );
      elizaLogger8.log(
        `Transferring: ${content.amount} tokens (${adjustedAmount} base units)`
      );
      const senderATA = getAssociatedTokenAddressSync3(
        mintPubkey,
        senderKeypair.publicKey
      );
      const recipientATA = getAssociatedTokenAddressSync3(
        mintPubkey,
        recipientPubkey
      );
      const instructions = [];
      const recipientATAInfo = await connection3.getAccountInfo(recipientATA);
      if (!recipientATAInfo) {
        const { createAssociatedTokenAccountInstruction } = await import("@solana/spl-token");
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
        recentBlockhash: (await connection3.getLatestBlockhash()).blockhash,
        instructions
      }).compileToV0Message();
      const transaction = new VersionedTransaction4(messageV0);
      transaction.sign([senderKeypair]);
      const signature = await connection3.sendTransaction(transaction);
      elizaLogger8.log("Transfer successful:", signature);
      if (callback) {
        callback({
          text: `Successfully transferred ${content.amount} tokens to ${content.recipient}
Transaction: ${signature}`,
          content: {
            success: true,
            signature,
            amount: content.amount,
            recipient: content.recipient
          }
        });
      }
      return true;
    } catch (error) {
      elizaLogger8.error("Error during token transfer:", error);
      if (callback) {
        callback({
          text: `Error transferring tokens: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: {
          text: "Send 69 EZSIS BieefG47jAHCGZBxi2q87RDuHyGZyYC3vAzxpyu8pump to 9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "I'll send 69 EZSIS tokens now...",
          action: "SEND_TOKEN"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Successfully sent 69 EZSIS tokens to 9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa\nTransaction: 5KtPn3DXXzHkb7VAVHZGwXJQqww39ASnrf7YkyJoF2qAGEpBEEGvRHLnnTG8ZVwKqNHMqSckWVGnsQAgfH5pbxEb"
        }
      }
    ]
  ]
};

// src/evaluators/trust.ts
import {
  booleanFooter,
  composeContext as composeContext6,
  elizaLogger as elizaLogger10,
  generateObjectArray,
  generateTrueOrFalse,
  MemoryManager,
  ModelClass as ModelClass6
} from "@elizaos/core";
import { Connection as Connection9 } from "@solana/web3.js";

// src/providers/token.ts
import {
  elizaLogger as elizaLogger9,
  settings as settings6
} from "@elizaos/core";
import NodeCache2 from "node-cache";
import * as path2 from "path";

// src/bignumber.ts
import BigNumber3 from "bignumber.js";
function toBN(value) {
  return new BigNumber3(value);
}

// src/providers/token.ts
import { Connection as Connection8 } from "@solana/web3.js";
var PROVIDER_CONFIG2 = {
  BIRDEYE_API: "https://public-api.birdeye.so",
  MAX_RETRIES: 3,
  RETRY_DELAY: 2e3,
  DEFAULT_RPC: "https://api.mainnet-beta.solana.com",
  TOKEN_ADDRESSES: {
    SOL: "So11111111111111111111111111111111111111112",
    BTC: "qfnqNqs3nCAHjnyCgLRDbBtq4p2MtHZxw8YjSyYhPoL",
    ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    Example: "2weMjPLLybRMMva1fM3U31goWWrCpF59CHWNhnCJ9Vyh"
  },
  TOKEN_SECURITY_ENDPOINT: "/defi/token_security?address=",
  TOKEN_TRADE_DATA_ENDPOINT: "/defi/v3/token/trade-data/single?address=",
  DEX_SCREENER_API: "https://api.dexscreener.com/latest/dex/tokens/",
  MAIN_WALLET: ""
};
var TokenProvider = class {
  constructor(tokenAddress2, walletProvider2, cacheManager) {
    this.tokenAddress = tokenAddress2;
    this.walletProvider = walletProvider2;
    this.cacheManager = cacheManager;
    this.cache = new NodeCache2({ stdTTL: 300 });
  }
  cache;
  cacheKey = "solana/tokens";
  NETWORK_ID = 1399811149;
  GRAPHQL_ENDPOINT = "https://graph.codex.io/graphql";
  async readFromCache(key) {
    const cached = await this.cacheManager.get(
      path2.join(this.cacheKey, key)
    );
    return cached;
  }
  async writeToCache(key, data) {
    await this.cacheManager.set(path2.join(this.cacheKey, key), data, {
      expires: Date.now() + 5 * 60 * 1e3
    });
  }
  async getCachedData(key) {
    const cachedData = this.cache.get(key);
    if (cachedData) {
      return cachedData;
    }
    const fileCachedData = await this.readFromCache(key);
    if (fileCachedData) {
      this.cache.set(key, fileCachedData);
      return fileCachedData;
    }
    return null;
  }
  async setCachedData(cacheKey, data) {
    this.cache.set(cacheKey, data);
    await this.writeToCache(cacheKey, data);
  }
  async fetchWithRetry(url, options = {}) {
    let lastError;
    for (let i = 0; i < PROVIDER_CONFIG2.MAX_RETRIES; i++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            Accept: "application/json",
            "x-chain": "solana",
            "X-API-KEY": settings6.BIRDEYE_API_KEY || "",
            ...options.headers
          }
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `HTTP error! status: ${response.status}, message: ${errorText}`
          );
        }
        const data = await response.json();
        return data;
      } catch (error) {
        elizaLogger9.error(`Attempt ${i + 1} failed:`, error);
        lastError = error;
        if (i < PROVIDER_CONFIG2.MAX_RETRIES - 1) {
          const delay = PROVIDER_CONFIG2.RETRY_DELAY * Math.pow(2, i);
          elizaLogger9.log(`Waiting ${delay}ms before retrying...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
    }
    elizaLogger9.error(
      "All attempts failed. Throwing the last error:",
      lastError
    );
    throw lastError;
  }
  async getTokensInWallet(runtime) {
    const walletInfo = await this.walletProvider.fetchPortfolioValue(runtime);
    const items = walletInfo.items;
    return items;
  }
  // check if the token symbol is in the wallet
  async getTokenFromWallet(runtime, tokenSymbol) {
    try {
      const items = await this.getTokensInWallet(runtime);
      const token = items.find((item) => item.symbol === tokenSymbol);
      if (token) {
        return token.address;
      } else {
        return null;
      }
    } catch (error) {
      elizaLogger9.error("Error checking token in wallet:", error);
      return null;
    }
  }
  async fetchTokenCodex() {
    try {
      const cacheKey = `token_${this.tokenAddress}`;
      const cachedData = await this.getCachedData(cacheKey);
      if (cachedData) {
        elizaLogger9.log(
          `Returning cached token data for ${this.tokenAddress}.`
        );
        return cachedData;
      }
      const query = `
            query Token($address: String!, $networkId: Int!) {
              token(input: { address: $address, networkId: $networkId }) {
                id
                address
                cmcId
                decimals
                name
                symbol
                totalSupply
                isScam
                info {
                  circulatingSupply
                  imageThumbUrl
                }
                explorerData {
                  blueCheckmark
                  description
                  tokenType
                }
              }
            }
          `;
      const variables = {
        address: this.tokenAddress,
        networkId: this.NETWORK_ID
        // Replace with your network ID
      };
      const response = await fetch(this.GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: settings6.CODEX_API_KEY
        },
        body: JSON.stringify({
          query,
          variables
        })
      }).then((res) => res.json());
      const token = response.data?.data?.token;
      if (!token) {
        throw new Error(`No data returned for token ${tokenAddress}`);
      }
      this.setCachedData(cacheKey, token);
      return {
        id: token.id,
        address: token.address,
        cmcId: token.cmcId,
        decimals: token.decimals,
        name: token.name,
        symbol: token.symbol,
        totalSupply: token.totalSupply,
        circulatingSupply: token.info?.circulatingSupply,
        imageThumbUrl: token.info?.imageThumbUrl,
        blueCheckmark: token.explorerData?.blueCheckmark,
        isScam: token.isScam ? true : false
      };
    } catch (error) {
      elizaLogger9.error(
        "Error fetching token data from Codex:",
        error.message
      );
      return {};
    }
  }
  async fetchPrices() {
    try {
      const cacheKey = "prices";
      const cachedData = await this.getCachedData(cacheKey);
      if (cachedData) {
        elizaLogger9.log("Returning cached prices.");
        return cachedData;
      }
      const { SOL, BTC, ETH } = PROVIDER_CONFIG2.TOKEN_ADDRESSES;
      const tokens = [SOL, BTC, ETH];
      const prices = {
        solana: { usd: "0" },
        bitcoin: { usd: "0" },
        ethereum: { usd: "0" }
      };
      for (const token of tokens) {
        const response = await this.fetchWithRetry(
          `${PROVIDER_CONFIG2.BIRDEYE_API}/defi/price?address=${token}`,
          {
            headers: {
              "x-chain": "solana"
            }
          }
        );
        if (response?.data?.value) {
          const price = response.data.value.toString();
          prices[token === SOL ? "solana" : token === BTC ? "bitcoin" : "ethereum"].usd = price;
        } else {
          elizaLogger9.warn(
            `No price data available for token: ${token}`
          );
        }
      }
      this.setCachedData(cacheKey, prices);
      return prices;
    } catch (error) {
      elizaLogger9.error("Error fetching prices:", error);
      throw error;
    }
  }
  async calculateBuyAmounts() {
    const dexScreenerData = await this.fetchDexScreenerData();
    const prices = await this.fetchPrices();
    const solPrice = toBN(prices.solana.usd);
    if (!dexScreenerData || dexScreenerData.pairs.length === 0) {
      return { none: 0, low: 0, medium: 0, high: 0 };
    }
    const pair = dexScreenerData.pairs[0];
    const { liquidity, marketCap } = pair;
    if (!liquidity || !marketCap) {
      return { none: 0, low: 0, medium: 0, high: 0 };
    }
    if (liquidity.usd === 0) {
      return { none: 0, low: 0, medium: 0, high: 0 };
    }
    if (marketCap < 1e5) {
      return { none: 0, low: 0, medium: 0, high: 0 };
    }
    const impactPercentages = {
      LOW: 0.01,
      // 1% of liquidity
      MEDIUM: 0.05,
      // 5% of liquidity
      HIGH: 0.1
      // 10% of liquidity
    };
    const lowBuyAmountUSD = liquidity.usd * impactPercentages.LOW;
    const mediumBuyAmountUSD = liquidity.usd * impactPercentages.MEDIUM;
    const highBuyAmountUSD = liquidity.usd * impactPercentages.HIGH;
    const lowBuyAmountSOL = toBN(lowBuyAmountUSD).div(solPrice).toNumber();
    const mediumBuyAmountSOL = toBN(mediumBuyAmountUSD).div(solPrice).toNumber();
    const highBuyAmountSOL = toBN(highBuyAmountUSD).div(solPrice).toNumber();
    return {
      none: 0,
      low: lowBuyAmountSOL,
      medium: mediumBuyAmountSOL,
      high: highBuyAmountSOL
    };
  }
  async fetchTokenSecurity() {
    const cacheKey = `tokenSecurity_${this.tokenAddress}`;
    const cachedData = await this.getCachedData(cacheKey);
    if (cachedData) {
      elizaLogger9.log(
        `Returning cached token security data for ${this.tokenAddress}.`
      );
      return cachedData;
    }
    const url = `${PROVIDER_CONFIG2.BIRDEYE_API}${PROVIDER_CONFIG2.TOKEN_SECURITY_ENDPOINT}${this.tokenAddress}`;
    const data = await this.fetchWithRetry(url);
    if (!data?.success || !data?.data) {
      throw new Error("No token security data available");
    }
    const security = {
      ownerBalance: data.data.ownerBalance,
      creatorBalance: data.data.creatorBalance,
      ownerPercentage: data.data.ownerPercentage,
      creatorPercentage: data.data.creatorPercentage,
      top10HolderBalance: data.data.top10HolderBalance,
      top10HolderPercent: data.data.top10HolderPercent
    };
    this.setCachedData(cacheKey, security);
    elizaLogger9.log(`Token security data cached for ${this.tokenAddress}.`);
    return security;
  }
  async fetchTokenTradeData() {
    const cacheKey = `tokenTradeData_${this.tokenAddress}`;
    const cachedData = await this.getCachedData(cacheKey);
    if (cachedData) {
      elizaLogger9.log(
        `Returning cached token trade data for ${this.tokenAddress}.`
      );
      return cachedData;
    }
    const url = `${PROVIDER_CONFIG2.BIRDEYE_API}${PROVIDER_CONFIG2.TOKEN_TRADE_DATA_ENDPOINT}${this.tokenAddress}`;
    const options = {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-API-KEY": settings6.BIRDEYE_API_KEY || ""
      }
    };
    const data = await fetch(url, options).then((res) => res.json()).catch((err) => elizaLogger9.error(err));
    if (!data?.success || !data?.data) {
      throw new Error("No token trade data available");
    }
    const tradeData = {
      address: data.data.address,
      holder: data.data.holder,
      market: data.data.market,
      last_trade_unix_time: data.data.last_trade_unix_time,
      last_trade_human_time: data.data.last_trade_human_time,
      price: data.data.price,
      history_30m_price: data.data.history_30m_price,
      price_change_30m_percent: data.data.price_change_30m_percent,
      history_1h_price: data.data.history_1h_price,
      price_change_1h_percent: data.data.price_change_1h_percent,
      history_2h_price: data.data.history_2h_price,
      price_change_2h_percent: data.data.price_change_2h_percent,
      history_4h_price: data.data.history_4h_price,
      price_change_4h_percent: data.data.price_change_4h_percent,
      history_6h_price: data.data.history_6h_price,
      price_change_6h_percent: data.data.price_change_6h_percent,
      history_8h_price: data.data.history_8h_price,
      price_change_8h_percent: data.data.price_change_8h_percent,
      history_12h_price: data.data.history_12h_price,
      price_change_12h_percent: data.data.price_change_12h_percent,
      history_24h_price: data.data.history_24h_price,
      price_change_24h_percent: data.data.price_change_24h_percent,
      unique_wallet_30m: data.data.unique_wallet_30m,
      unique_wallet_history_30m: data.data.unique_wallet_history_30m,
      unique_wallet_30m_change_percent: data.data.unique_wallet_30m_change_percent,
      unique_wallet_1h: data.data.unique_wallet_1h,
      unique_wallet_history_1h: data.data.unique_wallet_history_1h,
      unique_wallet_1h_change_percent: data.data.unique_wallet_1h_change_percent,
      unique_wallet_2h: data.data.unique_wallet_2h,
      unique_wallet_history_2h: data.data.unique_wallet_history_2h,
      unique_wallet_2h_change_percent: data.data.unique_wallet_2h_change_percent,
      unique_wallet_4h: data.data.unique_wallet_4h,
      unique_wallet_history_4h: data.data.unique_wallet_history_4h,
      unique_wallet_4h_change_percent: data.data.unique_wallet_4h_change_percent,
      unique_wallet_8h: data.data.unique_wallet_8h,
      unique_wallet_history_8h: data.data.unique_wallet_history_8h,
      unique_wallet_8h_change_percent: data.data.unique_wallet_8h_change_percent,
      unique_wallet_24h: data.data.unique_wallet_24h,
      unique_wallet_history_24h: data.data.unique_wallet_history_24h,
      unique_wallet_24h_change_percent: data.data.unique_wallet_24h_change_percent,
      trade_30m: data.data.trade_30m,
      trade_history_30m: data.data.trade_history_30m,
      trade_30m_change_percent: data.data.trade_30m_change_percent,
      sell_30m: data.data.sell_30m,
      sell_history_30m: data.data.sell_history_30m,
      sell_30m_change_percent: data.data.sell_30m_change_percent,
      buy_30m: data.data.buy_30m,
      buy_history_30m: data.data.buy_history_30m,
      buy_30m_change_percent: data.data.buy_30m_change_percent,
      volume_30m: data.data.volume_30m,
      volume_30m_usd: data.data.volume_30m_usd,
      volume_history_30m: data.data.volume_history_30m,
      volume_history_30m_usd: data.data.volume_history_30m_usd,
      volume_30m_change_percent: data.data.volume_30m_change_percent,
      volume_buy_30m: data.data.volume_buy_30m,
      volume_buy_30m_usd: data.data.volume_buy_30m_usd,
      volume_buy_history_30m: data.data.volume_buy_history_30m,
      volume_buy_history_30m_usd: data.data.volume_buy_history_30m_usd,
      volume_buy_30m_change_percent: data.data.volume_buy_30m_change_percent,
      volume_sell_30m: data.data.volume_sell_30m,
      volume_sell_30m_usd: data.data.volume_sell_30m_usd,
      volume_sell_history_30m: data.data.volume_sell_history_30m,
      volume_sell_history_30m_usd: data.data.volume_sell_history_30m_usd,
      volume_sell_30m_change_percent: data.data.volume_sell_30m_change_percent,
      trade_1h: data.data.trade_1h,
      trade_history_1h: data.data.trade_history_1h,
      trade_1h_change_percent: data.data.trade_1h_change_percent,
      sell_1h: data.data.sell_1h,
      sell_history_1h: data.data.sell_history_1h,
      sell_1h_change_percent: data.data.sell_1h_change_percent,
      buy_1h: data.data.buy_1h,
      buy_history_1h: data.data.buy_history_1h,
      buy_1h_change_percent: data.data.buy_1h_change_percent,
      volume_1h: data.data.volume_1h,
      volume_1h_usd: data.data.volume_1h_usd,
      volume_history_1h: data.data.volume_history_1h,
      volume_history_1h_usd: data.data.volume_history_1h_usd,
      volume_1h_change_percent: data.data.volume_1h_change_percent,
      volume_buy_1h: data.data.volume_buy_1h,
      volume_buy_1h_usd: data.data.volume_buy_1h_usd,
      volume_buy_history_1h: data.data.volume_buy_history_1h,
      volume_buy_history_1h_usd: data.data.volume_buy_history_1h_usd,
      volume_buy_1h_change_percent: data.data.volume_buy_1h_change_percent,
      volume_sell_1h: data.data.volume_sell_1h,
      volume_sell_1h_usd: data.data.volume_sell_1h_usd,
      volume_sell_history_1h: data.data.volume_sell_history_1h,
      volume_sell_history_1h_usd: data.data.volume_sell_history_1h_usd,
      volume_sell_1h_change_percent: data.data.volume_sell_1h_change_percent,
      trade_2h: data.data.trade_2h,
      trade_history_2h: data.data.trade_history_2h,
      trade_2h_change_percent: data.data.trade_2h_change_percent,
      sell_2h: data.data.sell_2h,
      sell_history_2h: data.data.sell_history_2h,
      sell_2h_change_percent: data.data.sell_2h_change_percent,
      buy_2h: data.data.buy_2h,
      buy_history_2h: data.data.buy_history_2h,
      buy_2h_change_percent: data.data.buy_2h_change_percent,
      volume_2h: data.data.volume_2h,
      volume_2h_usd: data.data.volume_2h_usd,
      volume_history_2h: data.data.volume_history_2h,
      volume_history_2h_usd: data.data.volume_history_2h_usd,
      volume_2h_change_percent: data.data.volume_2h_change_percent,
      volume_buy_2h: data.data.volume_buy_2h,
      volume_buy_2h_usd: data.data.volume_buy_2h_usd,
      volume_buy_history_2h: data.data.volume_buy_history_2h,
      volume_buy_history_2h_usd: data.data.volume_buy_history_2h_usd,
      volume_buy_2h_change_percent: data.data.volume_buy_2h_change_percent,
      volume_sell_2h: data.data.volume_sell_2h,
      volume_sell_2h_usd: data.data.volume_sell_2h_usd,
      volume_sell_history_2h: data.data.volume_sell_history_2h,
      volume_sell_history_2h_usd: data.data.volume_sell_history_2h_usd,
      volume_sell_2h_change_percent: data.data.volume_sell_2h_change_percent,
      trade_4h: data.data.trade_4h,
      trade_history_4h: data.data.trade_history_4h,
      trade_4h_change_percent: data.data.trade_4h_change_percent,
      sell_4h: data.data.sell_4h,
      sell_history_4h: data.data.sell_history_4h,
      sell_4h_change_percent: data.data.sell_4h_change_percent,
      buy_4h: data.data.buy_4h,
      buy_history_4h: data.data.buy_history_4h,
      buy_4h_change_percent: data.data.buy_4h_change_percent,
      volume_4h: data.data.volume_4h,
      volume_4h_usd: data.data.volume_4h_usd,
      volume_history_4h: data.data.volume_history_4h,
      volume_history_4h_usd: data.data.volume_history_4h_usd,
      volume_4h_change_percent: data.data.volume_4h_change_percent,
      volume_buy_4h: data.data.volume_buy_4h,
      volume_buy_4h_usd: data.data.volume_buy_4h_usd,
      volume_buy_history_4h: data.data.volume_buy_history_4h,
      volume_buy_history_4h_usd: data.data.volume_buy_history_4h_usd,
      volume_buy_4h_change_percent: data.data.volume_buy_4h_change_percent,
      volume_sell_4h: data.data.volume_sell_4h,
      volume_sell_4h_usd: data.data.volume_sell_4h_usd,
      volume_sell_history_4h: data.data.volume_sell_history_4h,
      volume_sell_history_4h_usd: data.data.volume_sell_history_4h_usd,
      volume_sell_4h_change_percent: data.data.volume_sell_4h_change_percent,
      trade_8h: data.data.trade_8h,
      trade_history_8h: data.data.trade_history_8h,
      trade_8h_change_percent: data.data.trade_8h_change_percent,
      sell_8h: data.data.sell_8h,
      sell_history_8h: data.data.sell_history_8h,
      sell_8h_change_percent: data.data.sell_8h_change_percent,
      buy_8h: data.data.buy_8h,
      buy_history_8h: data.data.buy_history_8h,
      buy_8h_change_percent: data.data.buy_8h_change_percent,
      volume_8h: data.data.volume_8h,
      volume_8h_usd: data.data.volume_8h_usd,
      volume_history_8h: data.data.volume_history_8h,
      volume_history_8h_usd: data.data.volume_history_8h_usd,
      volume_8h_change_percent: data.data.volume_8h_change_percent,
      volume_buy_8h: data.data.volume_buy_8h,
      volume_buy_8h_usd: data.data.volume_buy_8h_usd,
      volume_buy_history_8h: data.data.volume_buy_history_8h,
      volume_buy_history_8h_usd: data.data.volume_buy_history_8h_usd,
      volume_buy_8h_change_percent: data.data.volume_buy_8h_change_percent,
      volume_sell_8h: data.data.volume_sell_8h,
      volume_sell_8h_usd: data.data.volume_sell_8h_usd,
      volume_sell_history_8h: data.data.volume_sell_history_8h,
      volume_sell_history_8h_usd: data.data.volume_sell_history_8h_usd,
      volume_sell_8h_change_percent: data.data.volume_sell_8h_change_percent,
      trade_24h: data.data.trade_24h,
      trade_history_24h: data.data.trade_history_24h,
      trade_24h_change_percent: data.data.trade_24h_change_percent,
      sell_24h: data.data.sell_24h,
      sell_history_24h: data.data.sell_history_24h,
      sell_24h_change_percent: data.data.sell_24h_change_percent,
      buy_24h: data.data.buy_24h,
      buy_history_24h: data.data.buy_history_24h,
      buy_24h_change_percent: data.data.buy_24h_change_percent,
      volume_24h: data.data.volume_24h,
      volume_24h_usd: data.data.volume_24h_usd,
      volume_history_24h: data.data.volume_history_24h,
      volume_history_24h_usd: data.data.volume_history_24h_usd,
      volume_24h_change_percent: data.data.volume_24h_change_percent,
      volume_buy_24h: data.data.volume_buy_24h,
      volume_buy_24h_usd: data.data.volume_buy_24h_usd,
      volume_buy_history_24h: data.data.volume_buy_history_24h,
      volume_buy_history_24h_usd: data.data.volume_buy_history_24h_usd,
      volume_buy_24h_change_percent: data.data.volume_buy_24h_change_percent,
      volume_sell_24h: data.data.volume_sell_24h,
      volume_sell_24h_usd: data.data.volume_sell_24h_usd,
      volume_sell_history_24h: data.data.volume_sell_history_24h,
      volume_sell_history_24h_usd: data.data.volume_sell_history_24h_usd,
      volume_sell_24h_change_percent: data.data.volume_sell_24h_change_percent
    };
    this.setCachedData(cacheKey, tradeData);
    return tradeData;
  }
  async fetchDexScreenerData() {
    const cacheKey = `dexScreenerData_${this.tokenAddress}`;
    const cachedData = await this.getCachedData(cacheKey);
    if (cachedData) {
      elizaLogger9.log("Returning cached DexScreener data.");
      return cachedData;
    }
    const url = `https://api.dexscreener.com/latest/dex/search?q=${this.tokenAddress}`;
    try {
      elizaLogger9.log(
        `Fetching DexScreener data for token: ${this.tokenAddress}`
      );
      const data = await fetch(url).then((res) => res.json()).catch((err) => {
        elizaLogger9.error(err);
      });
      if (!data || !data.pairs) {
        throw new Error("No DexScreener data available");
      }
      const dexData = {
        schemaVersion: data.schemaVersion,
        pairs: data.pairs
      };
      this.setCachedData(cacheKey, dexData);
      return dexData;
    } catch (error) {
      elizaLogger9.error(`Error fetching DexScreener data:`, error);
      return {
        schemaVersion: "1.0.0",
        pairs: []
      };
    }
  }
  async searchDexScreenerData(symbol) {
    const cacheKey = `dexScreenerData_search_${symbol}`;
    const cachedData = await this.getCachedData(cacheKey);
    if (cachedData) {
      elizaLogger9.log("Returning cached search DexScreener data.");
      return this.getHighestLiquidityPair(cachedData);
    }
    const url = `https://api.dexscreener.com/latest/dex/search?q=${symbol}`;
    try {
      elizaLogger9.log(`Fetching DexScreener data for symbol: ${symbol}`);
      const data = await fetch(url).then((res) => res.json()).catch((err) => {
        elizaLogger9.error(err);
        return null;
      });
      if (!data || !data.pairs || data.pairs.length === 0) {
        throw new Error("No DexScreener data available");
      }
      const dexData = {
        schemaVersion: data.schemaVersion,
        pairs: data.pairs
      };
      this.setCachedData(cacheKey, dexData);
      return this.getHighestLiquidityPair(dexData);
    } catch (error) {
      elizaLogger9.error(`Error fetching DexScreener data:`, error);
      return null;
    }
  }
  getHighestLiquidityPair(dexData) {
    if (dexData.pairs.length === 0) {
      return null;
    }
    return dexData.pairs.sort((a, b) => {
      const liquidityDiff = b.liquidity.usd - a.liquidity.usd;
      if (liquidityDiff !== 0) {
        return liquidityDiff;
      }
      return b.marketCap - a.marketCap;
    })[0];
  }
  async analyzeHolderDistribution(tradeData) {
    const intervals = [
      {
        period: "30m",
        change: tradeData.unique_wallet_30m_change_percent
      },
      { period: "1h", change: tradeData.unique_wallet_1h_change_percent },
      { period: "2h", change: tradeData.unique_wallet_2h_change_percent },
      { period: "4h", change: tradeData.unique_wallet_4h_change_percent },
      { period: "8h", change: tradeData.unique_wallet_8h_change_percent },
      {
        period: "24h",
        change: tradeData.unique_wallet_24h_change_percent
      }
    ];
    const validChanges = intervals.map((interval) => interval.change).filter(
      (change) => change !== null && change !== void 0
    );
    if (validChanges.length === 0) {
      return "stable";
    }
    const averageChange = validChanges.reduce((acc, curr) => acc + curr, 0) / validChanges.length;
    const increaseThreshold = 10;
    const decreaseThreshold = -10;
    if (averageChange > increaseThreshold) {
      return "increasing";
    } else if (averageChange < decreaseThreshold) {
      return "decreasing";
    } else {
      return "stable";
    }
  }
  async fetchHolderList() {
    const cacheKey = `holderList_${this.tokenAddress}`;
    const cachedData = await this.getCachedData(cacheKey);
    if (cachedData) {
      elizaLogger9.log("Returning cached holder list.");
      return cachedData;
    }
    const allHoldersMap = /* @__PURE__ */ new Map();
    let page = 1;
    const limit = 1e3;
    let cursor;
    const url = `https://mainnet.helius-rpc.com/?api-key=${settings6.HELIUS_API_KEY || ""}`;
    elizaLogger9.log({ url });
    try {
      while (true) {
        const params = {
          limit,
          displayOptions: {},
          mint: this.tokenAddress,
          cursor
        };
        if (cursor != void 0) {
          params.cursor = cursor;
        }
        elizaLogger9.log(`Fetching holders - Page ${page}`);
        if (page > 2) {
          break;
        }
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "helius-test",
            method: "getTokenAccounts",
            params
          })
        });
        const data = await response.json();
        if (!data || !data.result || !data.result.token_accounts || data.result.token_accounts.length === 0) {
          elizaLogger9.log(
            `No more holders found. Total pages fetched: ${page - 1}`
          );
          break;
        }
        elizaLogger9.log(
          `Processing ${data.result.token_accounts.length} holders from page ${page}`
        );
        data.result.token_accounts.forEach((account) => {
          const owner = account.owner;
          const balance = parseFloat(account.amount);
          if (allHoldersMap.has(owner)) {
            allHoldersMap.set(
              owner,
              allHoldersMap.get(owner) + balance
            );
          } else {
            allHoldersMap.set(owner, balance);
          }
        });
        cursor = data.result.cursor;
        page++;
      }
      const holders = Array.from(
        allHoldersMap.entries()
      ).map(([address, balance]) => ({
        address,
        balance: balance.toString()
      }));
      elizaLogger9.log(`Total unique holders fetched: ${holders.length}`);
      this.setCachedData(cacheKey, holders);
      return holders;
    } catch (error) {
      elizaLogger9.error("Error fetching holder list from Helius:", error);
      throw new Error("Failed to fetch holder list from Helius.");
    }
  }
  async filterHighValueHolders(tradeData) {
    const holdersData = await this.fetchHolderList();
    const tokenPriceUsd = toBN(tradeData.price);
    const highValueHolders = holdersData.filter((holder) => {
      const balanceUsd = toBN(holder.balance).multipliedBy(
        tokenPriceUsd
      );
      return balanceUsd.isGreaterThan(5);
    }).map((holder) => ({
      holderAddress: holder.address,
      balanceUsd: toBN(holder.balance).multipliedBy(tokenPriceUsd).toFixed(2)
    }));
    return highValueHolders;
  }
  async checkRecentTrades(tradeData) {
    return toBN(tradeData.volume_24h_usd).isGreaterThan(0);
  }
  async countHighSupplyHolders(securityData) {
    try {
      const ownerBalance = toBN(securityData.ownerBalance);
      const totalSupply = ownerBalance.plus(securityData.creatorBalance);
      const highSupplyHolders = await this.fetchHolderList();
      const highSupplyHoldersCount = highSupplyHolders.filter(
        (holder) => {
          const balance = toBN(holder.balance);
          return balance.dividedBy(totalSupply).isGreaterThan(0.02);
        }
      ).length;
      return highSupplyHoldersCount;
    } catch (error) {
      elizaLogger9.error("Error counting high supply holders:", error);
      return 0;
    }
  }
  async getProcessedTokenData() {
    try {
      elizaLogger9.log(
        `Fetching security data for token: ${this.tokenAddress}`
      );
      const security = await this.fetchTokenSecurity();
      const tokenCodex = await this.fetchTokenCodex();
      elizaLogger9.log(
        `Fetching trade data for token: ${this.tokenAddress}`
      );
      const tradeData = await this.fetchTokenTradeData();
      elizaLogger9.log(
        `Fetching DexScreener data for token: ${this.tokenAddress}`
      );
      const dexData = await this.fetchDexScreenerData();
      elizaLogger9.log(
        `Analyzing holder distribution for token: ${this.tokenAddress}`
      );
      const holderDistributionTrend = await this.analyzeHolderDistribution(tradeData);
      elizaLogger9.log(
        `Filtering high-value holders for token: ${this.tokenAddress}`
      );
      const highValueHolders = await this.filterHighValueHolders(tradeData);
      elizaLogger9.log(
        `Checking recent trades for token: ${this.tokenAddress}`
      );
      const recentTrades = await this.checkRecentTrades(tradeData);
      elizaLogger9.log(
        `Counting high-supply holders for token: ${this.tokenAddress}`
      );
      const highSupplyHoldersCount = await this.countHighSupplyHolders(security);
      elizaLogger9.log(
        `Determining DexScreener listing status for token: ${this.tokenAddress}`
      );
      const isDexScreenerListed = dexData.pairs.length > 0;
      const isDexScreenerPaid = dexData.pairs.some(
        (pair) => pair.boosts && pair.boosts.active > 0
      );
      const processedData = {
        security,
        tradeData,
        holderDistributionTrend,
        highValueHolders,
        recentTrades,
        highSupplyHoldersCount,
        dexScreenerData: dexData,
        isDexScreenerListed,
        isDexScreenerPaid,
        tokenCodex
      };
      return processedData;
    } catch (error) {
      elizaLogger9.error("Error processing token data:", error);
      throw error;
    }
  }
  async shouldTradeToken() {
    try {
      const tokenData = await this.getProcessedTokenData();
      const { tradeData, security, dexScreenerData } = tokenData;
      const { ownerBalance, creatorBalance } = security;
      const { liquidity, marketCap } = dexScreenerData.pairs[0];
      const liquidityUsd = toBN(liquidity.usd);
      const marketCapUsd = toBN(marketCap);
      const totalSupply = toBN(ownerBalance).plus(creatorBalance);
      const _ownerPercentage = toBN(ownerBalance).dividedBy(totalSupply);
      const _creatorPercentage = toBN(creatorBalance).dividedBy(totalSupply);
      const top10HolderPercent = toBN(tradeData.volume_24h_usd).dividedBy(
        totalSupply
      );
      const priceChange24hPercent = toBN(
        tradeData.price_change_24h_percent
      );
      const priceChange12hPercent = toBN(
        tradeData.price_change_12h_percent
      );
      const uniqueWallet24h = tradeData.unique_wallet_24h;
      const volume24hUsd = toBN(tradeData.volume_24h_usd);
      const volume24hUsdThreshold = 1e3;
      const priceChange24hPercentThreshold = 10;
      const priceChange12hPercentThreshold = 5;
      const top10HolderPercentThreshold = 0.05;
      const uniqueWallet24hThreshold = 100;
      const isTop10Holder = top10HolderPercent.gte(
        top10HolderPercentThreshold
      );
      const isVolume24h = volume24hUsd.gte(volume24hUsdThreshold);
      const isPriceChange24h = priceChange24hPercent.gte(
        priceChange24hPercentThreshold
      );
      const isPriceChange12h = priceChange12hPercent.gte(
        priceChange12hPercentThreshold
      );
      const isUniqueWallet24h = uniqueWallet24h >= uniqueWallet24hThreshold;
      const isLiquidityTooLow = liquidityUsd.lt(1e3);
      const isMarketCapTooLow = marketCapUsd.lt(1e5);
      return isTop10Holder || isVolume24h || isPriceChange24h || isPriceChange12h || isUniqueWallet24h || isLiquidityTooLow || isMarketCapTooLow;
    } catch (error) {
      elizaLogger9.error("Error processing token data:", error);
      throw error;
    }
  }
  formatTokenData(data) {
    let output = `**Token Security and Trade Report**
`;
    output += `Token Address: ${this.tokenAddress}

`;
    output += `**Ownership Distribution:**
`;
    output += `- Owner Balance: ${data.security.ownerBalance}
`;
    output += `- Creator Balance: ${data.security.creatorBalance}
`;
    output += `- Owner Percentage: ${data.security.ownerPercentage}%
`;
    output += `- Creator Percentage: ${data.security.creatorPercentage}%
`;
    output += `- Top 10 Holders Balance: ${data.security.top10HolderBalance}
`;
    output += `- Top 10 Holders Percentage: ${data.security.top10HolderPercent}%

`;
    output += `**Trade Data:**
`;
    output += `- Holders: ${data.tradeData.holder}
`;
    output += `- Unique Wallets (24h): ${data.tradeData.unique_wallet_24h}
`;
    output += `- Price Change (24h): ${data.tradeData.price_change_24h_percent}%
`;
    output += `- Price Change (12h): ${data.tradeData.price_change_12h_percent}%
`;
    output += `- Volume (24h USD): $${toBN(data.tradeData.volume_24h_usd).toFixed(2)}
`;
    output += `- Current Price: $${toBN(data.tradeData.price).toFixed(2)}

`;
    output += `**Holder Distribution Trend:** ${data.holderDistributionTrend}

`;
    output += `**High-Value Holders (>$5 USD):**
`;
    if (data.highValueHolders.length === 0) {
      output += `- No high-value holders found or data not available.
`;
    } else {
      data.highValueHolders.forEach((holder) => {
        output += `- ${holder.holderAddress}: $${holder.balanceUsd}
`;
      });
    }
    output += `
`;
    output += `**Recent Trades (Last 24h):** ${data.recentTrades ? "Yes" : "No"}

`;
    output += `**Holders with >2% Supply:** ${data.highSupplyHoldersCount}

`;
    output += `**DexScreener Listing:** ${data.isDexScreenerListed ? "Yes" : "No"}
`;
    if (data.isDexScreenerListed) {
      output += `- Listing Type: ${data.isDexScreenerPaid ? "Paid" : "Free"}
`;
      output += `- Number of DexPairs: ${data.dexScreenerData.pairs.length}

`;
      output += `**DexScreener Pairs:**
`;
      data.dexScreenerData.pairs.forEach((pair, index) => {
        output += `
**Pair ${index + 1}:**
`;
        output += `- DEX: ${pair.dexId}
`;
        output += `- URL: ${pair.url}
`;
        output += `- Price USD: $${toBN(pair.priceUsd).toFixed(6)}
`;
        output += `- Volume (24h USD): $${toBN(pair.volume.h24).toFixed(2)}
`;
        output += `- Boosts Active: ${pair.boosts && pair.boosts.active}
`;
        output += `- Liquidity USD: $${toBN(pair.liquidity.usd).toFixed(2)}
`;
      });
    }
    output += `
`;
    elizaLogger9.log("Formatted token data:", output);
    return output;
  }
  async getFormattedTokenReport() {
    try {
      elizaLogger9.log("Generating formatted token report...");
      const processedData = await this.getProcessedTokenData();
      return this.formatTokenData(processedData);
    } catch (error) {
      elizaLogger9.error("Error generating token report:", error);
      return "Unable to fetch token information. Please try again later.";
    }
  }
};
var tokenAddress = PROVIDER_CONFIG2.TOKEN_ADDRESSES.Example;
var connection2 = new Connection8(PROVIDER_CONFIG2.DEFAULT_RPC);

// src/evaluators/trust.ts
var shouldProcessTemplate = `# Task: Decide if the recent messages should be processed for token recommendations.

    Look for messages that:
    - Mention specific token tickers or contract addresses
    - Contain words related to buying, selling, or trading tokens
    - Express opinions or convictions about tokens

    Based on the following conversation, should the messages be processed for recommendations? YES or NO

    {{recentMessages}}

    Should the messages be processed for recommendations? ` + booleanFooter;
var formatRecommendations = (recommendations) => {
  const messageStrings = recommendations.reverse().map((rec) => `${rec.content?.content}`);
  const finalMessageStrings = messageStrings.join("\n");
  return finalMessageStrings;
};
var recommendationTemplate = `TASK: Extract recommendations to buy or sell memecoins from the conversation as an array of objects in JSON format.

    Memecoins usually have a ticker and a contract address. Additionally, recommenders may make recommendations with some amount of conviction. The amount of conviction in their recommendation can be none, low, medium, or high. Recommenders can make recommendations to buy, not buy, sell and not sell.

# START OF EXAMPLES
These are an examples of the expected output of this task:
{{evaluationExamples}}
# END OF EXAMPLES

# INSTRUCTIONS

Extract any new recommendations from the conversation that are not already present in the list of known recommendations below:
{{recentRecommendations}}

- Include the recommender's username
- Try not to include already-known recommendations. If you think a recommendation is already known, but you're not sure, respond with alreadyKnown: true.
- Set the conviction to 'none', 'low', 'medium' or 'high'
- Set the recommendation type to 'buy', 'dont_buy', 'sell', or 'dont_sell'
- Include the contract address and/or ticker if available

Recent Messages:
{{recentMessages}}

Response should be a JSON object array inside a JSON markdown block. Correct response format:
\`\`\`json
[
  {
    "recommender": string,
    "ticker": string | null,
    "contractAddress": string | null,
    "type": enum<buy|dont_buy|sell|dont_sell>,
    "conviction": enum<none|low|medium|high>,
    "alreadyKnown": boolean
  },
  ...
]
\`\`\``;
async function handler(runtime, message) {
  elizaLogger10.log("Evaluating for trust");
  const state = await runtime.composeState(message);
  if (runtime.getSetting("POSTGRES_URL")) {
    elizaLogger10.warn("skipping trust evaluator because db is postgres");
    return [];
  }
  const { agentId, roomId } = state;
  const shouldProcessContext = composeContext6({
    state,
    template: shouldProcessTemplate
  });
  const shouldProcess = await generateTrueOrFalse({
    context: shouldProcessContext,
    modelClass: ModelClass6.SMALL,
    runtime
  });
  if (!shouldProcess) {
    elizaLogger10.log("Skipping process");
    return [];
  }
  elizaLogger10.log("Processing recommendations");
  const recommendationsManager = new MemoryManager({
    runtime,
    tableName: "recommendations"
  });
  const recentRecommendations = await recommendationsManager.getMemories({
    roomId,
    count: 20
  });
  const context = composeContext6({
    state: {
      ...state,
      recentRecommendations: formatRecommendations(recentRecommendations)
    },
    template: recommendationTemplate
  });
  const recommendations = await generateObjectArray({
    runtime,
    context,
    modelClass: ModelClass6.LARGE
  });
  elizaLogger10.log("recommendations", recommendations);
  if (!recommendations) {
    return [];
  }
  const filteredRecommendations = recommendations.filter((rec) => {
    return !rec.alreadyKnown && (rec.ticker || rec.contractAddress) && rec.recommender && rec.conviction && rec.recommender.trim() !== "";
  });
  const { publicKey } = await getWalletKey(runtime, false);
  for (const rec of filteredRecommendations) {
    const walletProvider2 = new WalletProvider(
      new Connection9(
        runtime.getSetting("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com"
      ),
      publicKey
    );
    const tokenProvider = new TokenProvider(
      rec.contractAddress,
      walletProvider2,
      runtime.cacheManager
    );
    if (!rec.contractAddress) {
      const tokenAddress2 = await tokenProvider.getTokenFromWallet(
        runtime,
        rec.ticker
      );
      rec.contractAddress = tokenAddress2;
      if (!tokenAddress2) {
        const result = await tokenProvider.searchDexScreenerData(
          rec.ticker
        );
        const tokenAddress3 = result?.baseToken?.address;
        rec.contractAddress = tokenAddress3;
        if (!tokenAddress3) {
          elizaLogger10.warn("Could not find contract address for token");
          continue;
        }
      }
    }
    const participants = await runtime.databaseAdapter.getParticipantsForRoom(
      message.roomId
    );
    const user = participants.find(async (actor) => {
      const user2 = await runtime.databaseAdapter.getAccountById(actor);
      return user2.name.toLowerCase().trim() === rec.recommender.toLowerCase().trim();
    });
    if (!user) {
      elizaLogger10.warn("Could not find user: ", rec.recommender);
      continue;
    }
    const account = await runtime.databaseAdapter.getAccountById(user);
    const userId = account.id;
    const recMemory = {
      userId,
      agentId,
      content: { text: JSON.stringify(rec) },
      roomId,
      createdAt: Date.now()
    };
    await recommendationsManager.createMemory(recMemory, true);
    elizaLogger10.log("recommendationsManager", rec);
    const buyAmounts = await tokenProvider.calculateBuyAmounts();
    let buyAmount = buyAmounts[rec.conviction.toLowerCase().trim()];
    if (!buyAmount) {
      buyAmount = 10;
    }
    const shouldTrade = await tokenProvider.shouldTradeToken();
    if (!shouldTrade) {
      elizaLogger10.warn(
        "There might be a problem with the token, not trading"
      );
      continue;
    }
    switch (rec.type) {
      case "buy":
        break;
      case "sell":
      case "dont_sell":
      case "dont_buy":
        elizaLogger10.warn("Not implemented");
        break;
    }
  }
  return filteredRecommendations;
}
var trustEvaluator = {
  name: "EXTRACT_RECOMMENDATIONS",
  similes: [
    "GET_RECOMMENDATIONS",
    "EXTRACT_TOKEN_RECS",
    "EXTRACT_MEMECOIN_RECS"
  ],
  alwaysRun: true,
  validate: async (runtime, message) => {
    if (message.content.text.length < 5) {
      return false;
    }
    return message.userId !== message.agentId;
  },
  description: "Extract recommendations to buy or sell memecoins/tokens from the conversation, including details like ticker, contract address, conviction level, and recommender username.",
  handler,
  examples: [
    {
      context: `Actors in the scene:
{{user1}}: Experienced DeFi degen. Constantly chasing high yield farms.
{{user2}}: New to DeFi, learning the ropes.

Recommendations about the actors:
None`,
      messages: [
        {
          user: "{{user1}}",
          content: {
            text: "Yo, have you checked out $SOLARUG? Dope new yield aggregator on Solana."
          }
        },
        {
          user: "{{user2}}",
          content: {
            text: "Nah, I'm still trying to wrap my head around how yield farming even works haha. Is it risky?"
          }
        },
        {
          user: "{{user1}}",
          content: {
            text: "I mean, there's always risk in DeFi, but the $SOLARUG devs seem legit. Threw a few sol into the FCweoTfJ128jGgNEXgdfTXdEZVk58Bz9trCemr6sXNx9 vault, farming's been smooth so far."
          }
        }
      ],
      outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",
    "ticker": "SOLARUG",
    "contractAddress": "FCweoTfJ128jGgNEXgdfTXdEZVk58Bz9trCemr6sXNx9",
    "type": "buy",
    "conviction": "medium",
    "alreadyKnown": false
  }
]
\`\`\``
    },
    {
      context: `Actors in the scene:
{{user1}}: Solana maximalist. Believes Solana will flip Ethereum.
{{user2}}: Multichain proponent. Holds both SOL and ETH.

Recommendations about the actors:
{{user1}} has previously promoted $COPETOKEN and $SOYLENT.`,
      messages: [
        {
          user: "{{user1}}",
          content: {
            text: "If you're not long $SOLVAULT at 7tRzKud6FBVFEhYqZS3CuQ2orLRM21bdisGykL5Sr4Dx, you're missing out. This will be the blackhole of Solana liquidity."
          }
        },
        {
          user: "{{user2}}",
          content: {
            text: "Idk man, feels like there's a new 'vault' or 'reserve' token every week on Sol. What happened to $COPETOKEN and $SOYLENT that you were shilling before?"
          }
        },
        {
          user: "{{user1}}",
          content: {
            text: "$COPETOKEN and $SOYLENT had their time, I took profits near the top. But $SOLVAULT is different, it has actual utility. Do what you want, but don't say I didn't warn you when this 50x's and you're left holding your $ETH bags."
          }
        }
      ],
      outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",
    "ticker": "COPETOKEN",
    "contractAddress": null,
    "type": "sell",
    "conviction": "low",
    "alreadyKnown": true
  },
  {
    "recommender": "{{user1}}",
    "ticker": "SOYLENT",
    "contractAddress": null,
    "type": "sell",
    "conviction": "low",
    "alreadyKnown": true
  },
  {
    "recommender": "{{user1}}",
    "ticker": "SOLVAULT",
    "contractAddress": "7tRzKud6FBVFEhYqZS3CuQ2orLRM21bdisGykL5Sr4Dx",
    "type": "buy",
    "conviction": "high",
    "alreadyKnown": false
  }
]
\`\`\``
    },
    {
      context: `Actors in the scene:
{{user1}}: Self-proclaimed Solana alpha caller. Allegedly has insider info.
{{user2}}: Degen gambler. Will ape into any hyped token.

Recommendations about the actors:
None`,
      messages: [
        {
          user: "{{user1}}",
          content: {
            text: "I normally don't do this, but I like you anon, so I'll let you in on some alpha. $ROULETTE at 48vV5y4DRH1Adr1bpvSgFWYCjLLPtHYBqUSwNc2cmCK2 is going to absolutely send it soon. You didn't hear it from me \u{1F910}"
          }
        },
        {
          user: "{{user2}}",
          content: {
            text: "Oh shit, insider info from the alpha god himself? Say no more, I'm aping in hard."
          }
        }
      ],
      outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",
    "ticker": "ROULETTE",
    "contractAddress": "48vV5y4DRH1Adr1bpvSgFWYCjLLPtHYBqUSwNc2cmCK2",
    "type": "buy",
    "conviction": "high",
    "alreadyKnown": false
  }
]
\`\`\``
    },
    {
      context: `Actors in the scene:
{{user1}}: NFT collector and trader. Bullish on Solana NFTs.
{{user2}}: Only invests based on fundamentals. Sees all NFTs as worthless JPEGs.

Recommendations about the actors:
None
`,
      messages: [
        {
          user: "{{user1}}",
          content: {
            text: "GM. I'm heavily accumulating $PIXELAPE, the token for the Pixel Ape Yacht Club NFT collection. 10x is inevitable."
          }
        },
        {
          user: "{{user2}}",
          content: {
            text: "NFTs are a scam bro. There's no underlying value. You're essentially trading worthless JPEGs."
          }
        },
        {
          user: "{{user1}}",
          content: {
            text: "Fun staying poor \u{1F921} $PIXELAPE is about to moon and you'll be left behind."
          }
        },
        {
          user: "{{user2}}",
          content: {
            text: "Whatever man, I'm not touching that shit with a ten foot pole. Have fun holding your bags."
          }
        },
        {
          user: "{{user1}}",
          content: {
            text: "Don't need luck where I'm going \u{1F60E} Once $PIXELAPE at 3hAKKmR6XyBooQBPezCbUMhrmcyTkt38sRJm2thKytWc takes off, you'll change your tune."
          }
        }
      ],
      outcome: `\`\`\`json
[
  {
    "recommender": "{{user1}}",
    "ticker": "PIXELAPE",
    "contractAddress": "3hAKKmR6XyBooQBPezCbUMhrmcyTkt38sRJm2thKytWc",
    "type": "buy",
    "conviction": "high",
    "alreadyKnown": false
  }
]
\`\`\``
    },
    {
      context: `Actors in the scene:
{{user1}}: Contrarian investor. Bets against hyped projects.
{{user2}}: Trend follower. Buys tokens that are currently popular.

Recommendations about the actors:
None`,
      messages: [
        {
          user: "{{user2}}",
          content: {
            text: "$SAMOYED is the talk of CT right now. Making serious moves. Might have to get a bag."
          }
        },
        {
          user: "{{user1}}",
          content: {
            text: "Whenever a token is the 'talk of CT', that's my cue to short it. $SAMOYED is going to dump hard, mark my words."
          }
        },
        {
          user: "{{user2}}",
          content: {
            text: "Idk man, the hype seems real this time. 5TQwHyZbedaH4Pcthj1Hxf5GqcigL6qWuB7YEsBtqvhr chart looks bullish af."
          }
        },
        {
          user: "{{user1}}",
          content: {
            text: "Hype is always real until it isn't. I'm taking out a fat short position here. Don't say I didn't warn you when this crashes 90% and you're left holding the flaming bags."
          }
        }
      ],
      outcome: `\`\`\`json
[
  {
    "recommender": "{{user2}}",
    "ticker": "SAMOYED",
    "contractAddress": "5TQwHyZbedaH4Pcthj1Hxf5GqcigL6qWuB7YEsBtqvhr",
    "type": "buy",
    "conviction": "medium",
    "alreadyKnown": false
  },
  {
    "recommender": "{{user1}}",
    "ticker": "SAMOYED",
    "contractAddress": "5TQwHyZbedaH4Pcthj1Hxf5GqcigL6qWuB7YEsBtqvhr",
    "type": "dont_buy",
    "conviction": "high",
    "alreadyKnown": false
  }
]
\`\`\``
    }
  ]
};

// src/providers/tokenUtils.ts
import { getAccount, getAssociatedTokenAddress as getAssociatedTokenAddress2 } from "@solana/spl-token";
import { PublicKey as PublicKey9 } from "@solana/web3.js";
import { elizaLogger as elizaLogger11 } from "@elizaos/core";
async function getTokenBalance(connection3, walletPublicKey, tokenMintAddress) {
  const tokenAccountAddress = await getAssociatedTokenAddress2(
    tokenMintAddress,
    walletPublicKey
  );
  try {
    const tokenAccount = await getAccount(connection3, tokenAccountAddress);
    const tokenAmount = tokenAccount.amount;
    return tokenAmount;
  } catch (error) {
    elizaLogger11.error(
      `Error retrieving balance for token: ${tokenMintAddress.toBase58()}`,
      error
    );
    return 0;
  }
}
async function getTokenBalances(connection3, walletPublicKey) {
  const tokenBalances = {};
  const tokenMintAddresses = [
    new PublicKey9("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    // USDC
    new PublicKey9("So11111111111111111111111111111111111111112")
    // SOL
    // Add more token mint addresses as needed
  ];
  for (const mintAddress of tokenMintAddresses) {
    const tokenName = getTokenName(mintAddress);
    const balance = await getTokenBalance(
      connection3,
      walletPublicKey,
      mintAddress
    );
    tokenBalances[tokenName] = balance;
  }
  return tokenBalances;
}
function getTokenName(mintAddress) {
  const tokenNameMap = {
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
    So11111111111111111111111111111111111111112: "SOL"
    // Add more token mint addresses and their corresponding names
  };
  return tokenNameMap[mintAddress.toBase58()] || "Unknown Token";
}

// src/index.ts
var solanaPlugin = {
  name: "solana",
  description: "Solana Plugin for Eliza",
  actions: [
    executeSwap,
    pumpfun_default,
    fomo_default,
    transfer_default,
    executeSwapForDAO,
    takeOrder_default
  ],
  evaluators: [trustEvaluator],
  providers: [
    walletProvider
    /*, trustScoreProvider*/
  ]
};
var index_default = solanaPlugin;
export {
  TokenProvider,
  WalletProvider,
  index_default as default,
  getTokenBalance,
  getTokenBalances,
  solanaPlugin
};
//# sourceMappingURL=index.js.map
// src/providers/token.ts
import {
  elizaLogger as elizaLogger3,
  settings
} from "@elizaos/core";
import NodeCache2 from "node-cache";
import * as path from "path";

// src/bignumber.ts
import BigNumber from "bignumber.js";
function toBN(value) {
  return new BigNumber(value);
}

// src/providers/wallet.ts
import {
  elizaLogger as elizaLogger2
} from "@elizaos/core";
import { Connection, PublicKey as PublicKey2 } from "@solana/web3.js";
import BigNumber2 from "bignumber.js";
import NodeCache from "node-cache";

// src/keypairUtils.ts
import { Keypair, PublicKey } from "@solana/web3.js";
import { DeriveKeyProvider, TEEMode } from "@elizaos/plugin-tee";
import bs58 from "bs58";
import { elizaLogger } from "@elizaos/core";
async function getWalletKey(runtime, requirePrivateKey = true) {
  const teeMode = runtime.getSetting("TEE_MODE") || TEEMode.OFF;
  if (teeMode !== TEEMode.OFF) {
    const walletSecretSalt = runtime.getSetting("WALLET_SECRET_SALT");
    if (!walletSecretSalt) {
      throw new Error(
        "WALLET_SECRET_SALT required when TEE_MODE is enabled"
      );
    }
    const deriveKeyProvider = new DeriveKeyProvider(teeMode);
    const deriveKeyResult = await deriveKeyProvider.deriveEd25519Keypair(
      walletSecretSalt,
      "solana",
      runtime.agentId
    );
    return requirePrivateKey ? { keypair: deriveKeyResult.keypair } : { publicKey: deriveKeyResult.keypair.publicKey };
  }
  if (requirePrivateKey) {
    const privateKeyString = runtime.getSetting("SOLANA_PRIVATE_KEY") ?? runtime.getSetting("WALLET_PRIVATE_KEY");
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
    const publicKeyString = runtime.getSetting("SOLANA_PUBLIC_KEY") ?? runtime.getSetting("WALLET_PUBLIC_KEY");
    if (!publicKeyString) {
      throw new Error("Public key not found in settings");
    }
    return { publicKey: new PublicKey(publicKeyString) };
  }
}

// src/providers/wallet.ts
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
          const totalUsd = new BigNumber2(data.totalUsd.toString());
          const prices = await this.fetchPrices(runtime);
          const solPriceInUSD = new BigNumber2(
            prices.solana.usd.toString()
          );
          const items2 = data.items.map((item) => ({
            ...item,
            valueSol: new BigNumber2(item.valueUsd || 0).div(solPriceInUSD).toFixed(6),
            name: item.name || "Unknown",
            symbol: item.symbol || "Unknown",
            priceUsd: item.priceUsd || "0",
            valueUsd: item.valueUsd || "0"
          }));
          const portfolio2 = {
            totalUsd: totalUsd.toString(),
            totalSol: totalUsd.div(solPriceInUSD).toFixed(6),
            items: items2.sort(
              (a, b) => new BigNumber2(b.valueUsd).minus(new BigNumber2(a.valueUsd)).toNumber()
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
      const solPriceInUSD = new BigNumber2(prices.solana.usd.toString());
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
        (sum, item) => sum.plus(new BigNumber2(item.valueUsd)),
        new BigNumber2(0)
      );
      const totalSol = totalUsd.div(solPriceInUSD);
      const portfolio = {
        totalUsd: totalUsd.toFixed(6),
        totalSol: totalSol.toFixed(6),
        items: items.sort(
          (a, b) => new BigNumber2(b.valueUsd).minus(new BigNumber2(a.valueUsd)).toNumber()
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
    const totalUsdFormatted = new BigNumber2(portfolio.totalUsd).toFixed(2);
    const totalSolFormatted = portfolio.totalSol;
    output += `Total Value: $${totalUsdFormatted} (${totalSolFormatted} SOL)

`;
    output += "Token Balances:\n";
    const nonZeroItems = portfolio.items.filter(
      (item) => new BigNumber2(item.uiAmount).isGreaterThan(0)
    );
    if (nonZeroItems.length === 0) {
      output += "No tokens found with non-zero balance\n";
    } else {
      for (const item of nonZeroItems) {
        const valueUsd = new BigNumber2(item.valueUsd).toFixed(2);
        output += `${item.name} (${item.symbol}): ${new BigNumber2(
          item.uiAmount
        ).toFixed(6)} ($${valueUsd} | ${item.valueSol} SOL)
`;
      }
    }
    output += "\nMarket Prices:\n";
    output += `SOL: $${new BigNumber2(prices.solana.usd).toFixed(2)}
`;
    output += `BTC: $${new BigNumber2(prices.bitcoin.usd).toFixed(2)}
`;
    output += `ETH: $${new BigNumber2(prices.ethereum.usd).toFixed(2)}
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

// src/providers/token.ts
import { Connection as Connection2 } from "@solana/web3.js";
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
      path.join(this.cacheKey, key)
    );
    return cached;
  }
  async writeToCache(key, data) {
    await this.cacheManager.set(path.join(this.cacheKey, key), data, {
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
            "X-API-KEY": settings.BIRDEYE_API_KEY || "",
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
        elizaLogger3.error(`Attempt ${i + 1} failed:`, error);
        lastError = error;
        if (i < PROVIDER_CONFIG2.MAX_RETRIES - 1) {
          const delay = PROVIDER_CONFIG2.RETRY_DELAY * Math.pow(2, i);
          elizaLogger3.log(`Waiting ${delay}ms before retrying...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
    }
    elizaLogger3.error(
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
      elizaLogger3.error("Error checking token in wallet:", error);
      return null;
    }
  }
  async fetchTokenCodex() {
    try {
      const cacheKey = `token_${this.tokenAddress}`;
      const cachedData = await this.getCachedData(cacheKey);
      if (cachedData) {
        elizaLogger3.log(
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
          Authorization: settings.CODEX_API_KEY
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
      elizaLogger3.error(
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
        elizaLogger3.log("Returning cached prices.");
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
          elizaLogger3.warn(
            `No price data available for token: ${token}`
          );
        }
      }
      this.setCachedData(cacheKey, prices);
      return prices;
    } catch (error) {
      elizaLogger3.error("Error fetching prices:", error);
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
      elizaLogger3.log(
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
    elizaLogger3.log(`Token security data cached for ${this.tokenAddress}.`);
    return security;
  }
  async fetchTokenTradeData() {
    const cacheKey = `tokenTradeData_${this.tokenAddress}`;
    const cachedData = await this.getCachedData(cacheKey);
    if (cachedData) {
      elizaLogger3.log(
        `Returning cached token trade data for ${this.tokenAddress}.`
      );
      return cachedData;
    }
    const url = `${PROVIDER_CONFIG2.BIRDEYE_API}${PROVIDER_CONFIG2.TOKEN_TRADE_DATA_ENDPOINT}${this.tokenAddress}`;
    const options = {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-API-KEY": settings.BIRDEYE_API_KEY || ""
      }
    };
    const data = await fetch(url, options).then((res) => res.json()).catch((err) => elizaLogger3.error(err));
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
      elizaLogger3.log("Returning cached DexScreener data.");
      return cachedData;
    }
    const url = `https://api.dexscreener.com/latest/dex/search?q=${this.tokenAddress}`;
    try {
      elizaLogger3.log(
        `Fetching DexScreener data for token: ${this.tokenAddress}`
      );
      const data = await fetch(url).then((res) => res.json()).catch((err) => {
        elizaLogger3.error(err);
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
      elizaLogger3.error(`Error fetching DexScreener data:`, error);
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
      elizaLogger3.log("Returning cached search DexScreener data.");
      return this.getHighestLiquidityPair(cachedData);
    }
    const url = `https://api.dexscreener.com/latest/dex/search?q=${symbol}`;
    try {
      elizaLogger3.log(`Fetching DexScreener data for symbol: ${symbol}`);
      const data = await fetch(url).then((res) => res.json()).catch((err) => {
        elizaLogger3.error(err);
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
      elizaLogger3.error(`Error fetching DexScreener data:`, error);
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
      elizaLogger3.log("Returning cached holder list.");
      return cachedData;
    }
    const allHoldersMap = /* @__PURE__ */ new Map();
    let page = 1;
    const limit = 1e3;
    let cursor;
    const url = `https://mainnet.helius-rpc.com/?api-key=${settings.HELIUS_API_KEY || ""}`;
    elizaLogger3.log({ url });
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
        elizaLogger3.log(`Fetching holders - Page ${page}`);
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
          elizaLogger3.log(
            `No more holders found. Total pages fetched: ${page - 1}`
          );
          break;
        }
        elizaLogger3.log(
          `Processing ${data.result.token_accounts.length} holders from page ${page}`
        );
        data.result.token_accounts.forEach((account) => {
          const owner = account.owner;
          const balance = Number.parseFloat(account.amount);
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
      elizaLogger3.log(`Total unique holders fetched: ${holders.length}`);
      this.setCachedData(cacheKey, holders);
      return holders;
    } catch (error) {
      elizaLogger3.error("Error fetching holder list from Helius:", error);
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
      elizaLogger3.error("Error counting high supply holders:", error);
      return 0;
    }
  }
  async getProcessedTokenData() {
    try {
      elizaLogger3.log(
        `Fetching security data for token: ${this.tokenAddress}`
      );
      const security = await this.fetchTokenSecurity();
      const tokenCodex = await this.fetchTokenCodex();
      elizaLogger3.log(
        `Fetching trade data for token: ${this.tokenAddress}`
      );
      const tradeData = await this.fetchTokenTradeData();
      elizaLogger3.log(
        `Fetching DexScreener data for token: ${this.tokenAddress}`
      );
      const dexData = await this.fetchDexScreenerData();
      elizaLogger3.log(
        `Analyzing holder distribution for token: ${this.tokenAddress}`
      );
      const holderDistributionTrend = await this.analyzeHolderDistribution(tradeData);
      elizaLogger3.log(
        `Filtering high-value holders for token: ${this.tokenAddress}`
      );
      const highValueHolders = await this.filterHighValueHolders(tradeData);
      elizaLogger3.log(
        `Checking recent trades for token: ${this.tokenAddress}`
      );
      const recentTrades = await this.checkRecentTrades(tradeData);
      elizaLogger3.log(
        `Counting high-supply holders for token: ${this.tokenAddress}`
      );
      const highSupplyHoldersCount = await this.countHighSupplyHolders(security);
      elizaLogger3.log(
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
      elizaLogger3.error("Error processing token data:", error);
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
      elizaLogger3.error("Error processing token data:", error);
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
    elizaLogger3.log("Formatted token data:", output);
    return output;
  }
  async getFormattedTokenReport() {
    try {
      elizaLogger3.log("Generating formatted token report...");
      const processedData = await this.getProcessedTokenData();
      return this.formatTokenData(processedData);
    } catch (error) {
      elizaLogger3.error("Error generating token report:", error);
      return "Unable to fetch token information. Please try again later.";
    }
  }
};
var tokenAddress = PROVIDER_CONFIG2.TOKEN_ADDRESSES.Example;
var connection = new Connection2(PROVIDER_CONFIG2.DEFAULT_RPC);
var tokenProvider = {
  get: async (runtime, _message, _state) => {
    try {
      const { publicKey } = await getWalletKey(runtime, false);
      const walletProvider2 = new WalletProvider(connection, publicKey);
      const provider = new TokenProvider(
        tokenAddress,
        walletProvider2,
        runtime.cacheManager
      );
      return provider.getFormattedTokenReport();
    } catch (error) {
      elizaLogger3.error("Error fetching token data:", error);
      return "Unable to fetch token information. Please try again later.";
    }
  }
};

// src/providers/trustScoreProvider.ts
import {
  elizaLogger as elizaLogger5,
  settings as settings2
} from "@elizaos/core";
import {
  TrustScoreDatabase
} from "@elizaos/plugin-trustdb";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { Connection as Connection4, PublicKey as PublicKey4 } from "@solana/web3.js";

// ../../node_modules/uuid/dist/esm-node/rng.js
import crypto from "crypto";
var rnds8Pool = new Uint8Array(256);
var poolPtr = rnds8Pool.length;
function rng() {
  if (poolPtr > rnds8Pool.length - 16) {
    crypto.randomFillSync(rnds8Pool);
    poolPtr = 0;
  }
  return rnds8Pool.slice(poolPtr, poolPtr += 16);
}

// ../../node_modules/uuid/dist/esm-node/regex.js
var regex_default = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;

// ../../node_modules/uuid/dist/esm-node/validate.js
function validate(uuid) {
  return typeof uuid === "string" && regex_default.test(uuid);
}
var validate_default = validate;

// ../../node_modules/uuid/dist/esm-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).substr(1));
}
function stringify(arr, offset = 0) {
  const uuid = (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
  if (!validate_default(uuid)) {
    throw TypeError("Stringified UUID is invalid");
  }
  return uuid;
}
var stringify_default = stringify;

// ../../node_modules/uuid/dist/esm-node/v4.js
function v4(options, buf, offset) {
  options = options || {};
  const rnds = options.random || (options.rng || rng)();
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return stringify_default(rnds);
}
var v4_default = v4;

// src/providers/simulationSellingService.ts
import { Connection as Connection3, PublicKey as PublicKey3 } from "@solana/web3.js";
import { elizaLogger as elizaLogger4 } from "@elizaos/core";
import * as amqp from "amqplib";
var SimulationSellingService = class {
  trustScoreDb;
  walletProvider;
  connection;
  baseMint;
  DECAY_RATE = 0.95;
  MAX_DECAY_DAYS = 30;
  backend;
  backendToken;
  amqpConnection;
  amqpChannel;
  sonarBe;
  sonarBeToken;
  runtime;
  runningProcesses = /* @__PURE__ */ new Set();
  constructor(runtime, trustScoreDb) {
    this.trustScoreDb = trustScoreDb;
    this.connection = new Connection3(runtime.getSetting("SOLANA_RPC_URL"));
    this.baseMint = new PublicKey3(
      runtime.getSetting("BASE_MINT") || "So11111111111111111111111111111111111111112"
    );
    this.backend = runtime.getSetting("BACKEND_URL");
    this.backendToken = runtime.getSetting("BACKEND_TOKEN");
    this.initializeRabbitMQ(runtime.getSetting("AMQP_URL"));
    this.sonarBe = runtime.getSetting("SONAR_BE");
    this.sonarBeToken = runtime.getSetting("SONAR_BE_TOKEN");
    this.runtime = runtime;
    this.initializeWalletProvider();
  }
  /**
   * Initializes the RabbitMQ connection and starts consuming messages.
   * @param amqpUrl The RabbitMQ server URL.
   */
  async initializeRabbitMQ(amqpUrl) {
    try {
      this.amqpConnection = await amqp.connect(amqpUrl);
      this.amqpChannel = await this.amqpConnection.createChannel();
      elizaLogger4.log("Connected to RabbitMQ");
      this.consumeMessages();
    } catch (error) {
      elizaLogger4.error("Failed to connect to RabbitMQ:", error);
    }
  }
  /**
   * Sets up the consumer for the specified RabbitMQ queue.
   */
  async consumeMessages() {
    const queue = "process_eliza_simulation";
    await this.amqpChannel.assertQueue(queue, { durable: true });
    this.amqpChannel.consume(
      queue,
      (msg) => {
        if (msg !== null) {
          const content = msg.content.toString();
          this.processMessage(content);
          this.amqpChannel.ack(msg);
        }
      },
      { noAck: false }
    );
    elizaLogger4.log(`Listening for messages on queue: ${queue}`);
  }
  /**
   * Processes incoming messages from RabbitMQ.
   * @param message The message content as a string.
   */
  async processMessage(message) {
    try {
      const { tokenAddress: tokenAddress2, amount, sell_recommender_id } = JSON.parse(message);
      elizaLogger4.log(
        `Received message for token ${tokenAddress2} to sell ${amount}`
      );
      const decision = {
        tokenPerformance: await this.trustScoreDb.getTokenPerformance(tokenAddress2),
        amountToSell: amount,
        sell_recommender_id
      };
      await this.executeSellDecision(decision);
      this.runningProcesses.delete(tokenAddress2);
    } catch (error) {
      elizaLogger4.error("Error processing message:", error);
    }
  }
  /**
   * Executes a single sell decision.
   * @param decision The sell decision containing token performance and amount to sell.
   */
  async executeSellDecision(decision) {
    const { tokenPerformance, amountToSell, sell_recommender_id } = decision;
    const tokenAddress2 = tokenPerformance.tokenAddress;
    try {
      elizaLogger4.log(
        `Executing sell for token ${tokenPerformance.symbol}: ${amountToSell}`
      );
      const sellDetails = {
        sell_amount: amountToSell,
        sell_recommender_id
        // Adjust if necessary
      };
      const sellTimeStamp = (/* @__PURE__ */ new Date()).toISOString();
      const tokenProvider2 = new TokenProvider(
        tokenAddress2,
        this.walletProvider,
        this.runtime.cacheManager
      );
      const sellDetailsData = await this.updateSellDetails(
        tokenAddress2,
        sell_recommender_id,
        sellTimeStamp,
        sellDetails,
        true,
        // isSimulation
        tokenProvider2
      );
      elizaLogger4.log(
        "Sell order executed successfully",
        sellDetailsData
      );
      const balance = this.trustScoreDb.getTokenBalance(tokenAddress2);
      if (balance === 0) {
        this.runningProcesses.delete(tokenAddress2);
      }
      await this.stopProcessInTheSonarBackend(tokenAddress2);
    } catch (error) {
      elizaLogger4.error(
        `Error executing sell for token ${tokenAddress2}:`,
        error
      );
    }
  }
  /**
   * Derives the public key based on the TEE (Trusted Execution Environment) mode and initializes the wallet provider.
   * If TEE mode is enabled, derives a keypair using the DeriveKeyProvider with the wallet secret salt and agent ID.
   * If TEE mode is disabled, uses the provided Solana public key or wallet public key from settings.
   */
  async initializeWalletProvider() {
    const { publicKey } = await getWalletKey(this.runtime, false);
    this.walletProvider = new WalletProvider(this.connection, publicKey);
  }
  async startService() {
    elizaLogger4.log("Starting SellingService...");
    await this.startListeners();
  }
  async startListeners() {
    elizaLogger4.log("Scanning for token performances...");
    const tokenPerformances = await this.trustScoreDb.getAllTokenPerformancesWithBalance();
    await this.processTokenPerformances(tokenPerformances);
  }
  processTokenPerformances(tokenPerformances) {
    elizaLogger4.log("Deciding when to sell and how much...");
    const runningProcesses = this.runningProcesses;
    tokenPerformances = tokenPerformances.filter(
      (tp) => !runningProcesses.has(tp.tokenAddress)
    );
    tokenPerformances.forEach(async (tokenPerformance) => {
      const tokenProvider2 = new TokenProvider(
        tokenPerformance.tokenAddress,
        this.walletProvider,
        this.runtime.cacheManager
      );
      const tokenRecommendations = this.trustScoreDb.getRecommendationsByToken(
        tokenPerformance.tokenAddress
      );
      const tokenRecommendation = tokenRecommendations[0];
      const balance = tokenPerformance.balance;
      const sell_recommender_id = tokenRecommendation.recommenderId;
      const tokenAddress2 = tokenPerformance.tokenAddress;
      const process = await this.startProcessInTheSonarBackend(
        tokenAddress2,
        balance,
        true,
        sell_recommender_id,
        tokenPerformance.initialMarketCap
      );
      if (process) {
        this.runningProcesses.add(tokenAddress2);
      }
    });
  }
  processTokenPerformance(tokenAddress2, recommenderId) {
    try {
      const runningProcesses = this.runningProcesses;
      if (runningProcesses.has(tokenAddress2)) {
        elizaLogger4.log(
          `Token ${tokenAddress2} is already being processed`
        );
        return;
      }
      const tokenPerformance = this.trustScoreDb.getTokenPerformance(tokenAddress2);
      const tokenProvider2 = new TokenProvider(
        tokenPerformance.tokenAddress,
        this.walletProvider,
        this.runtime.cacheManager
      );
      const balance = tokenPerformance.balance;
      const sell_recommender_id = recommenderId;
      const process = this.startProcessInTheSonarBackend(
        tokenAddress2,
        balance,
        true,
        sell_recommender_id,
        tokenPerformance.initialMarketCap
      );
      if (process) {
        this.runningProcesses.add(tokenAddress2);
      }
    } catch (error) {
      elizaLogger4.error(
        `Error getting token performance for token ${tokenAddress2}:`,
        error
      );
    }
  }
  async startProcessInTheSonarBackend(tokenAddress2, balance, isSimulation, sell_recommender_id, initial_mc) {
    try {
      const message = JSON.stringify({
        tokenAddress: tokenAddress2,
        balance,
        isSimulation,
        initial_mc,
        sell_recommender_id
      });
      const response = await fetch(
        `${this.sonarBe}/elizaos-sol/startProcess`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": `${this.sonarBeToken}`
          },
          body: message
        }
      );
      if (!response.ok) {
        elizaLogger4.error(
          `Failed to send message to process token ${tokenAddress2}`
        );
        return;
      }
      const result = await response.json();
      elizaLogger4.log("Received response:", result);
      elizaLogger4.log(`Sent message to process token ${tokenAddress2}`);
      return result;
    } catch (error) {
      elizaLogger4.error(
        `Error sending message to process token ${tokenAddress2}:`,
        error
      );
      return null;
    }
  }
  stopProcessInTheSonarBackend(tokenAddress2) {
    try {
      return fetch(`${this.sonarBe}/elizaos-sol/stopProcess`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": `${this.sonarBeToken}`
        },
        body: JSON.stringify({ tokenAddress: tokenAddress2 })
      });
    } catch (error) {
      elizaLogger4.error(
        `Error stopping process for token ${tokenAddress2}:`,
        error
      );
    }
  }
  async updateSellDetails(tokenAddress2, recommenderId, sellTimeStamp, sellDetails, isSimulation, tokenProvider2) {
    const recommender = await this.trustScoreDb.getOrCreateRecommenderWithTelegramId(
      recommenderId
    );
    const processedData = await tokenProvider2.getProcessedTokenData();
    const prices = await this.walletProvider.fetchPrices(null);
    const solPrice = prices.solana.usd;
    const sellSol = sellDetails.sell_amount / Number.parseFloat(solPrice);
    const sell_value_usd = sellDetails.sell_amount * processedData.tradeData.price;
    const trade = await this.trustScoreDb.getLatestTradePerformance(
      tokenAddress2,
      recommender.id,
      isSimulation
    );
    const buyTimeStamp = trade.buy_timeStamp;
    const marketCap = processedData.dexScreenerData.pairs[0]?.marketCap || 0;
    const liquidity = processedData.dexScreenerData.pairs[0]?.liquidity.usd || 0;
    const sell_price = processedData.tradeData.price;
    const profit_usd = sell_value_usd - trade.buy_value_usd;
    const profit_percent = profit_usd / trade.buy_value_usd * 100;
    const market_cap_change = marketCap - trade.buy_market_cap;
    const liquidity_change = liquidity - trade.buy_liquidity;
    const isRapidDump = await this.isRapidDump(tokenAddress2, tokenProvider2);
    const sellDetailsData = {
      sell_price,
      sell_timeStamp: sellTimeStamp,
      sell_amount: sellDetails.sell_amount,
      received_sol: sellSol,
      sell_value_usd,
      profit_usd,
      profit_percent,
      sell_market_cap: marketCap,
      market_cap_change,
      sell_liquidity: liquidity,
      liquidity_change,
      rapidDump: isRapidDump,
      sell_recommender_id: sellDetails.sell_recommender_id || null
    };
    this.trustScoreDb.updateTradePerformanceOnSell(
      tokenAddress2,
      recommender.id,
      buyTimeStamp,
      sellDetailsData,
      isSimulation
    );
    const oldBalance = this.trustScoreDb.getTokenBalance(tokenAddress2);
    const tokenBalance = oldBalance - sellDetails.sell_amount;
    this.trustScoreDb.updateTokenBalance(tokenAddress2, tokenBalance);
    const hash = Math.random().toString(36).substring(7);
    const transaction = {
      tokenAddress: tokenAddress2,
      type: "sell",
      transactionHash: hash,
      amount: sellDetails.sell_amount,
      price: processedData.tradeData.price,
      isSimulation: true,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.trustScoreDb.addTransaction(transaction);
    this.updateTradeInBe(
      tokenAddress2,
      recommender.id,
      recommender.telegramId,
      sellDetailsData,
      tokenBalance
    );
    return sellDetailsData;
  }
  async isRapidDump(tokenAddress2, tokenProvider2) {
    const processedData = await tokenProvider2.getProcessedTokenData();
    elizaLogger4.log(
      `Fetched processed token data for token: ${tokenAddress2}`
    );
    return processedData.tradeData.trade_24h_change_percent < -50;
  }
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async updateTradeInBe(tokenAddress2, recommenderId, username, data, balanceLeft, retries = 3, delayMs = 2e3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await fetch(
          `${this.backend}/api/updaters/updateTradePerformance`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.backendToken}`
            },
            body: JSON.stringify({
              tokenAddress: tokenAddress2,
              tradeData: data,
              recommenderId,
              username,
              isSimulation: true,
              balanceLeft
            })
          }
        );
        return;
      } catch (error) {
        elizaLogger4.error(
          `Attempt ${attempt} failed: Error creating trade in backend`,
          error
        );
        if (attempt < retries) {
          elizaLogger4.log(`Retrying in ${delayMs} ms...`);
          await this.delay(delayMs);
        } else {
          elizaLogger4.error("All attempts failed.");
        }
      }
    }
  }
};

// src/providers/trustScoreProvider.ts
var Wallet = settings2.MAIN_WALLET_ADDRESS;
var TrustScoreManager = class {
  tokenProvider;
  trustScoreDb;
  simulationSellingService;
  connection;
  baseMint;
  DECAY_RATE = 0.95;
  MAX_DECAY_DAYS = 30;
  backend;
  backendToken;
  constructor(runtime, tokenProvider2, trustScoreDb) {
    this.tokenProvider = tokenProvider2;
    this.trustScoreDb = trustScoreDb;
    this.connection = new Connection4(runtime.getSetting("SOLANA_RPC_URL"));
    this.baseMint = new PublicKey4(
      runtime.getSetting("BASE_MINT") || "So11111111111111111111111111111111111111112"
    );
    this.backend = runtime.getSetting("BACKEND_URL");
    this.backendToken = runtime.getSetting("BACKEND_TOKEN");
    this.simulationSellingService = new SimulationSellingService(
      runtime,
      this.trustScoreDb
    );
  }
  //getRecommenederBalance
  async getRecommenederBalance(recommenderWallet) {
    try {
      const tokenAta = await getAssociatedTokenAddress(
        new PublicKey4(recommenderWallet),
        this.baseMint
      );
      const tokenBalInfo = await this.connection.getTokenAccountBalance(tokenAta);
      const tokenBalance = tokenBalInfo.value.amount;
      const balance = Number.parseFloat(tokenBalance);
      return balance;
    } catch (error) {
      elizaLogger5.error("Error fetching balance", error);
      return 0;
    }
  }
  /**
   * Generates and saves trust score based on processed token data and user recommendations.
   * @param tokenAddress The address of the token to analyze.
   * @param recommenderId The UUID of the recommender.
   * @returns An object containing TokenPerformance and RecommenderMetrics.
   */
  async generateTrustScore(tokenAddress2, recommenderId, recommenderWallet) {
    const processedData = await this.tokenProvider.getProcessedTokenData();
    elizaLogger5.log(
      `Fetched processed token data for token: ${tokenAddress2}`
    );
    const recommenderMetrics = await this.trustScoreDb.getRecommenderMetrics(recommenderId);
    const isRapidDump = await this.isRapidDump(tokenAddress2);
    const sustainedGrowth = await this.sustainedGrowth(tokenAddress2);
    const suspiciousVolume = await this.suspiciousVolume(tokenAddress2);
    const balance = await this.getRecommenederBalance(recommenderWallet);
    const virtualConfidence = balance / 1e6;
    const lastActive = recommenderMetrics.lastActiveDate;
    const now = /* @__PURE__ */ new Date();
    const inactiveDays = Math.floor(
      (now.getTime() - lastActive.getTime()) / (1e3 * 60 * 60 * 24)
    );
    const decayFactor = Math.pow(
      this.DECAY_RATE,
      Math.min(inactiveDays, this.MAX_DECAY_DAYS)
    );
    const decayedScore = recommenderMetrics.trustScore * decayFactor;
    const validationTrustScore = this.trustScoreDb.calculateValidationTrust(tokenAddress2);
    return {
      tokenPerformance: {
        tokenAddress: processedData.dexScreenerData.pairs[0]?.baseToken.address || "",
        priceChange24h: processedData.tradeData.price_change_24h_percent,
        volumeChange24h: processedData.tradeData.volume_24h,
        trade_24h_change: processedData.tradeData.trade_24h_change_percent,
        liquidity: processedData.dexScreenerData.pairs[0]?.liquidity.usd || 0,
        liquidityChange24h: 0,
        holderChange24h: processedData.tradeData.unique_wallet_24h_change_percent,
        rugPull: false,
        isScam: processedData.tokenCodex.isScam,
        marketCapChange24h: 0,
        sustainedGrowth,
        rapidDump: isRapidDump,
        suspiciousVolume,
        validationTrust: validationTrustScore,
        balance,
        initialMarketCap: processedData.dexScreenerData.pairs[0]?.marketCap || 0,
        lastUpdated: /* @__PURE__ */ new Date(),
        symbol: ""
      },
      recommenderMetrics: {
        recommenderId,
        trustScore: recommenderMetrics.trustScore,
        totalRecommendations: recommenderMetrics.totalRecommendations,
        successfulRecs: recommenderMetrics.successfulRecs,
        avgTokenPerformance: recommenderMetrics.avgTokenPerformance,
        riskScore: recommenderMetrics.riskScore,
        consistencyScore: recommenderMetrics.consistencyScore,
        virtualConfidence,
        lastActiveDate: now,
        trustDecay: decayedScore,
        lastUpdated: /* @__PURE__ */ new Date()
      }
    };
  }
  async updateRecommenderMetrics(recommenderId, tokenPerformance, recommenderWallet) {
    const recommenderMetrics = await this.trustScoreDb.getRecommenderMetrics(recommenderId);
    const totalRecommendations = recommenderMetrics.totalRecommendations + 1;
    const successfulRecs = tokenPerformance.rugPull ? recommenderMetrics.successfulRecs : recommenderMetrics.successfulRecs + 1;
    const avgTokenPerformance = (recommenderMetrics.avgTokenPerformance * recommenderMetrics.totalRecommendations + tokenPerformance.priceChange24h) / totalRecommendations;
    const overallTrustScore = this.calculateTrustScore(
      tokenPerformance,
      recommenderMetrics
    );
    const riskScore = this.calculateOverallRiskScore(
      tokenPerformance,
      recommenderMetrics
    );
    const consistencyScore = this.calculateConsistencyScore(
      tokenPerformance,
      recommenderMetrics
    );
    const balance = await this.getRecommenederBalance(recommenderWallet);
    const virtualConfidence = balance / 1e6;
    const lastActive = recommenderMetrics.lastActiveDate;
    const now = /* @__PURE__ */ new Date();
    const inactiveDays = Math.floor(
      (now.getTime() - lastActive.getTime()) / (1e3 * 60 * 60 * 24)
    );
    const decayFactor = Math.pow(
      this.DECAY_RATE,
      Math.min(inactiveDays, this.MAX_DECAY_DAYS)
    );
    const decayedScore = recommenderMetrics.trustScore * decayFactor;
    const newRecommenderMetrics = {
      recommenderId,
      trustScore: overallTrustScore,
      totalRecommendations,
      successfulRecs,
      avgTokenPerformance,
      riskScore,
      consistencyScore,
      virtualConfidence,
      lastActiveDate: /* @__PURE__ */ new Date(),
      trustDecay: decayedScore,
      lastUpdated: /* @__PURE__ */ new Date()
    };
    await this.trustScoreDb.updateRecommenderMetrics(newRecommenderMetrics);
  }
  calculateTrustScore(tokenPerformance, recommenderMetrics) {
    const riskScore = this.calculateRiskScore(tokenPerformance);
    const consistencyScore = this.calculateConsistencyScore(
      tokenPerformance,
      recommenderMetrics
    );
    return (riskScore + consistencyScore) / 2;
  }
  calculateOverallRiskScore(tokenPerformance, recommenderMetrics) {
    const riskScore = this.calculateRiskScore(tokenPerformance);
    const consistencyScore = this.calculateConsistencyScore(
      tokenPerformance,
      recommenderMetrics
    );
    return (riskScore + consistencyScore) / 2;
  }
  calculateRiskScore(tokenPerformance) {
    let riskScore = 0;
    if (tokenPerformance.rugPull) {
      riskScore += 10;
    }
    if (tokenPerformance.isScam) {
      riskScore += 10;
    }
    if (tokenPerformance.rapidDump) {
      riskScore += 5;
    }
    if (tokenPerformance.suspiciousVolume) {
      riskScore += 5;
    }
    return riskScore;
  }
  calculateConsistencyScore(tokenPerformance, recommenderMetrics) {
    const avgTokenPerformance = recommenderMetrics.avgTokenPerformance;
    const priceChange24h = tokenPerformance.priceChange24h;
    return Math.abs(priceChange24h - avgTokenPerformance);
  }
  async suspiciousVolume(tokenAddress2) {
    const processedData = await this.tokenProvider.getProcessedTokenData();
    const unique_wallet_24h = processedData.tradeData.unique_wallet_24h;
    const volume_24h = processedData.tradeData.volume_24h;
    const suspiciousVolume = unique_wallet_24h / volume_24h > 0.5;
    elizaLogger5.log(
      `Fetched processed token data for token: ${tokenAddress2}`
    );
    return suspiciousVolume;
  }
  async sustainedGrowth(tokenAddress2) {
    const processedData = await this.tokenProvider.getProcessedTokenData();
    elizaLogger5.log(
      `Fetched processed token data for token: ${tokenAddress2}`
    );
    return processedData.tradeData.volume_24h_change_percent > 50;
  }
  async isRapidDump(tokenAddress2) {
    const processedData = await this.tokenProvider.getProcessedTokenData();
    elizaLogger5.log(
      `Fetched processed token data for token: ${tokenAddress2}`
    );
    return processedData.tradeData.trade_24h_change_percent < -50;
  }
  async checkTrustScore(tokenAddress2) {
    const processedData = await this.tokenProvider.getProcessedTokenData();
    elizaLogger5.log(
      `Fetched processed token data for token: ${tokenAddress2}`
    );
    return {
      ownerBalance: processedData.security.ownerBalance,
      creatorBalance: processedData.security.creatorBalance,
      ownerPercentage: processedData.security.ownerPercentage,
      creatorPercentage: processedData.security.creatorPercentage,
      top10HolderBalance: processedData.security.top10HolderBalance,
      top10HolderPercent: processedData.security.top10HolderPercent
    };
  }
  /**
   * Creates a TradePerformance object based on token data and recommender.
   * @param tokenAddress The address of the token.
   * @param recommenderId The UUID of the recommender.
   * @param data ProcessedTokenData.
   * @returns TradePerformance object.
   */
  async createTradePerformance(runtime, tokenAddress2, recommenderId, data) {
    const recommender = await this.trustScoreDb.getOrCreateRecommenderWithTelegramId(
      recommenderId
    );
    const processedData = await this.tokenProvider.getProcessedTokenData();
    const wallet = new WalletProvider(
      this.connection,
      new PublicKey4(Wallet)
    );
    let tokensBalance = 0;
    const prices = await wallet.fetchPrices(runtime);
    const solPrice = prices.solana.usd;
    const buySol = data.buy_amount / Number.parseFloat(solPrice);
    const buy_value_usd = data.buy_amount * processedData.tradeData.price;
    const token = await this.tokenProvider.fetchTokenTradeData();
    const tokenCodex = await this.tokenProvider.fetchTokenCodex();
    const tokenPrice = token.price;
    tokensBalance = buy_value_usd / tokenPrice;
    const creationData = {
      token_address: tokenAddress2,
      recommender_id: recommender.id,
      buy_price: processedData.tradeData.price,
      sell_price: 0,
      buy_timeStamp: (/* @__PURE__ */ new Date()).toISOString(),
      sell_timeStamp: "",
      buy_amount: data.buy_amount,
      sell_amount: 0,
      buy_sol: buySol,
      received_sol: 0,
      buy_value_usd,
      sell_value_usd: 0,
      profit_usd: 0,
      profit_percent: 0,
      buy_market_cap: processedData.dexScreenerData.pairs[0]?.marketCap || 0,
      sell_market_cap: 0,
      market_cap_change: 0,
      buy_liquidity: processedData.dexScreenerData.pairs[0]?.liquidity.usd || 0,
      sell_liquidity: 0,
      liquidity_change: 0,
      last_updated: (/* @__PURE__ */ new Date()).toISOString(),
      rapidDump: false
    };
    this.trustScoreDb.addTradePerformance(creationData, data.is_simulation);
    const tokenUUId = v4_default();
    const tokenRecommendation = {
      id: tokenUUId,
      recommenderId,
      tokenAddress: tokenAddress2,
      timestamp: /* @__PURE__ */ new Date(),
      initialMarketCap: processedData.dexScreenerData.pairs[0]?.marketCap || 0,
      initialLiquidity: processedData.dexScreenerData.pairs[0]?.liquidity?.usd || 0,
      initialPrice: processedData.tradeData.price
    };
    this.trustScoreDb.addTokenRecommendation(tokenRecommendation);
    this.trustScoreDb.upsertTokenPerformance({
      tokenAddress: tokenAddress2,
      symbol: processedData.tokenCodex.symbol,
      priceChange24h: processedData.tradeData.price_change_24h_percent,
      volumeChange24h: processedData.tradeData.volume_24h,
      trade_24h_change: processedData.tradeData.trade_24h_change_percent,
      liquidity: processedData.dexScreenerData.pairs[0]?.liquidity.usd || 0,
      liquidityChange24h: 0,
      holderChange24h: processedData.tradeData.unique_wallet_24h_change_percent,
      rugPull: false,
      isScam: tokenCodex.isScam,
      marketCapChange24h: 0,
      sustainedGrowth: false,
      rapidDump: false,
      suspiciousVolume: false,
      validationTrust: 0,
      balance: tokensBalance,
      initialMarketCap: processedData.dexScreenerData.pairs[0]?.marketCap || 0,
      lastUpdated: /* @__PURE__ */ new Date()
    });
    if (data.is_simulation) {
      this.trustScoreDb.updateTokenBalance(tokenAddress2, tokensBalance);
      const hash = Math.random().toString(36).substring(7);
      const transaction = {
        tokenAddress: tokenAddress2,
        type: "buy",
        transactionHash: hash,
        amount: data.buy_amount,
        price: processedData.tradeData.price,
        isSimulation: true,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.trustScoreDb.addTransaction(transaction);
    }
    this.simulationSellingService.processTokenPerformance(
      tokenAddress2,
      recommenderId
    );
    this.createTradeInBe(tokenAddress2, recommenderId, data);
    return creationData;
  }
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async createTradeInBe(tokenAddress2, recommenderId, data, retries = 3, delayMs = 2e3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await fetch(
          `${this.backend}/api/updaters/createTradePerformance`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.backendToken}`
            },
            body: JSON.stringify({
              tokenAddress: tokenAddress2,
              tradeData: data,
              recommenderId
            })
          }
        );
        return;
      } catch (error) {
        elizaLogger5.error(
          `Attempt ${attempt} failed: Error creating trade in backend`,
          error
        );
        if (attempt < retries) {
          elizaLogger5.log(`Retrying in ${delayMs} ms...`);
          await this.delay(delayMs);
        } else {
          elizaLogger5.error("All attempts failed.");
        }
      }
    }
  }
  /**
   * Updates a trade with sell details.
   * @param tokenAddress The address of the token.
   * @param recommenderId The UUID of the recommender.
   * @param buyTimeStamp The timestamp when the buy occurred.
   * @param sellDetails An object containing sell-related details.
   * @param isSimulation Whether the trade is a simulation. If true, updates in simulation_trade; otherwise, in trade.
   * @returns boolean indicating success.
   */
  async updateSellDetails(runtime, tokenAddress2, recommenderId, sellTimeStamp, sellDetails, isSimulation) {
    const recommender = await this.trustScoreDb.getOrCreateRecommenderWithTelegramId(
      recommenderId
    );
    const processedData = await this.tokenProvider.getProcessedTokenData();
    const wallet = new WalletProvider(
      this.connection,
      new PublicKey4(Wallet)
    );
    const prices = await wallet.fetchPrices(runtime);
    const solPrice = prices.solana.usd;
    const sellSol = sellDetails.sell_amount / Number.parseFloat(solPrice);
    const sell_value_usd = sellDetails.sell_amount * processedData.tradeData.price;
    const trade = await this.trustScoreDb.getLatestTradePerformance(
      tokenAddress2,
      recommender.id,
      isSimulation
    );
    const buyTimeStamp = trade.buy_timeStamp;
    const marketCap = processedData.dexScreenerData.pairs[0]?.marketCap || 0;
    const liquidity = processedData.dexScreenerData.pairs[0]?.liquidity.usd || 0;
    const sell_price = processedData.tradeData.price;
    const profit_usd = sell_value_usd - trade.buy_value_usd;
    const profit_percent = profit_usd / trade.buy_value_usd * 100;
    const market_cap_change = marketCap - trade.buy_market_cap;
    const liquidity_change = liquidity - trade.buy_liquidity;
    const isRapidDump = await this.isRapidDump(tokenAddress2);
    const sellDetailsData = {
      sell_price,
      sell_timeStamp: sellTimeStamp,
      sell_amount: sellDetails.sell_amount,
      received_sol: sellSol,
      sell_value_usd,
      profit_usd,
      profit_percent,
      sell_market_cap: marketCap,
      market_cap_change,
      sell_liquidity: liquidity,
      liquidity_change,
      rapidDump: isRapidDump,
      sell_recommender_id: sellDetails.sell_recommender_id || null
    };
    this.trustScoreDb.updateTradePerformanceOnSell(
      tokenAddress2,
      recommender.id,
      buyTimeStamp,
      sellDetailsData,
      isSimulation
    );
    if (isSimulation) {
      const oldBalance = this.trustScoreDb.getTokenBalance(tokenAddress2);
      const tokenBalance = oldBalance - sellDetails.sell_amount;
      this.trustScoreDb.updateTokenBalance(tokenAddress2, tokenBalance);
      const hash = Math.random().toString(36).substring(7);
      const transaction = {
        tokenAddress: tokenAddress2,
        type: "sell",
        transactionHash: hash,
        amount: sellDetails.sell_amount,
        price: processedData.tradeData.price,
        isSimulation: true,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.trustScoreDb.addTransaction(transaction);
    }
    return sellDetailsData;
  }
  // get all recommendations
  async getRecommendations(startDate, endDate) {
    const recommendations = this.trustScoreDb.getRecommendationsByDateRange(
      startDate,
      endDate
    );
    const groupedRecommendations = recommendations.reduce(
      (acc, recommendation) => {
        const { tokenAddress: tokenAddress2 } = recommendation;
        if (!acc[tokenAddress2]) acc[tokenAddress2] = [];
        acc[tokenAddress2].push(recommendation);
        return acc;
      },
      {}
    );
    const result = Object.keys(groupedRecommendations).map(
      (tokenAddress2) => {
        const tokenRecommendations = groupedRecommendations[tokenAddress2];
        let totalTrustScore = 0;
        let totalRiskScore = 0;
        let totalConsistencyScore = 0;
        const recommenderData = [];
        tokenRecommendations.forEach((recommendation) => {
          const tokenPerformance = this.trustScoreDb.getTokenPerformance(
            recommendation.tokenAddress
          );
          const recommenderMetrics = this.trustScoreDb.getRecommenderMetrics(
            recommendation.recommenderId
          );
          const trustScore = this.calculateTrustScore(
            tokenPerformance,
            recommenderMetrics
          );
          const consistencyScore = this.calculateConsistencyScore(
            tokenPerformance,
            recommenderMetrics
          );
          const riskScore = this.calculateRiskScore(tokenPerformance);
          totalTrustScore += trustScore;
          totalRiskScore += riskScore;
          totalConsistencyScore += consistencyScore;
          recommenderData.push({
            recommenderId: recommendation.recommenderId,
            trustScore,
            riskScore,
            consistencyScore,
            recommenderMetrics
          });
        });
        const averageTrustScore = totalTrustScore / tokenRecommendations.length;
        const averageRiskScore = totalRiskScore / tokenRecommendations.length;
        const averageConsistencyScore = totalConsistencyScore / tokenRecommendations.length;
        return {
          tokenAddress: tokenAddress2,
          averageTrustScore,
          averageRiskScore,
          averageConsistencyScore,
          recommenders: recommenderData
        };
      }
    );
    result.sort((a, b) => b.averageTrustScore - a.averageTrustScore);
    return result;
  }
};
var trustScoreProvider = {
  async get(runtime, message, _state) {
    try {
      if (runtime.getSetting("POSTGRES_URL")) {
        elizaLogger5.warn(
          "skipping trust evaluator because db is postgres"
        );
        return "";
      }
      const trustScoreDb = new TrustScoreDatabase(
        runtime.databaseAdapter.db
      );
      const userId = message.userId;
      if (!userId) {
        elizaLogger5.error("User ID is missing from the message");
        return "";
      }
      const recommenderMetrics = await trustScoreDb.getRecommenderMetrics(userId);
      if (!recommenderMetrics) {
        elizaLogger5.error(
          "No recommender metrics found for user:",
          userId
        );
        return "";
      }
      const trustScore = recommenderMetrics.trustScore;
      const user = await runtime.databaseAdapter.getAccountById(userId);
      const trustScoreString = `${user.name}'s trust score: ${trustScore.toFixed(2)}`;
      return trustScoreString;
    } catch (error) {
      elizaLogger5.error("Error in trust score provider:", error.message);
      return `Failed to fetch trust score: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }
};

// src/evaluators/trust.ts
import {
  booleanFooter,
  composeContext,
  elizaLogger as elizaLogger6,
  generateObjectArray,
  generateTrueOrFalse,
  MemoryManager,
  ModelClass
} from "@elizaos/core";
import { TrustScoreDatabase as TrustScoreDatabase2 } from "@elizaos/plugin-trustdb";
import { Connection as Connection5 } from "@solana/web3.js";
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
  elizaLogger6.log("Evaluating for trust");
  const state = await runtime.composeState(message);
  if (runtime.getSetting("POSTGRES_URL")) {
    elizaLogger6.warn("skipping trust evaluator because db is postgres");
    return [];
  }
  const { agentId, roomId } = state;
  const shouldProcessContext = composeContext({
    state,
    template: shouldProcessTemplate
  });
  const shouldProcess = await generateTrueOrFalse({
    context: shouldProcessContext,
    modelClass: ModelClass.SMALL,
    runtime
  });
  if (!shouldProcess) {
    elizaLogger6.log("Skipping process");
    return [];
  }
  elizaLogger6.log("Processing recommendations");
  const recommendationsManager = new MemoryManager({
    runtime,
    tableName: "recommendations"
  });
  const recentRecommendations = await recommendationsManager.getMemories({
    roomId,
    count: 20
  });
  const context = composeContext({
    state: {
      ...state,
      recentRecommendations: formatRecommendations(recentRecommendations)
    },
    template: recommendationTemplate
  });
  const recommendations = await generateObjectArray({
    runtime,
    context,
    modelClass: ModelClass.LARGE
  });
  elizaLogger6.log("recommendations", recommendations);
  if (!recommendations) {
    return [];
  }
  const filteredRecommendations = recommendations.filter((rec) => {
    return !rec.alreadyKnown && (rec.ticker || rec.contractAddress) && rec.recommender && rec.conviction && rec.recommender.trim() !== "";
  });
  const { publicKey } = await getWalletKey(runtime, false);
  for (const rec of filteredRecommendations) {
    const walletProvider2 = new WalletProvider(
      new Connection5(
        runtime.getSetting("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com"
      ),
      publicKey
    );
    const tokenProvider2 = new TokenProvider(
      rec.contractAddress,
      walletProvider2,
      runtime.cacheManager
    );
    if (!rec.contractAddress) {
      const tokenAddress2 = await tokenProvider2.getTokenFromWallet(
        runtime,
        rec.ticker
      );
      rec.contractAddress = tokenAddress2;
      if (!tokenAddress2) {
        const result = await tokenProvider2.searchDexScreenerData(
          rec.ticker
        );
        const tokenAddress3 = result?.baseToken?.address;
        rec.contractAddress = tokenAddress3;
        if (!tokenAddress3) {
          elizaLogger6.warn("Could not find contract address for token");
          continue;
        }
      }
    }
    const trustScoreDb = new TrustScoreDatabase2(runtime.databaseAdapter.db);
    const trustScoreManager = new TrustScoreManager(
      runtime,
      tokenProvider2,
      trustScoreDb
    );
    const participants = await runtime.databaseAdapter.getParticipantsForRoom(
      message.roomId
    );
    const user = participants.find(async (actor) => {
      const user2 = await runtime.databaseAdapter.getAccountById(actor);
      return user2.name.toLowerCase().trim() === rec.recommender.toLowerCase().trim();
    });
    if (!user) {
      elizaLogger6.warn("Could not find user: ", rec.recommender);
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
    elizaLogger6.log("recommendationsManager", rec);
    const buyAmounts = await tokenProvider2.calculateBuyAmounts();
    let buyAmount = buyAmounts[rec.conviction.toLowerCase().trim()];
    if (!buyAmount) {
      buyAmount = 10;
    }
    const shouldTrade = await tokenProvider2.shouldTradeToken();
    if (!shouldTrade) {
      elizaLogger6.warn(
        "There might be a problem with the token, not trading"
      );
      continue;
    }
    switch (rec.type) {
      case "buy":
        await trustScoreManager.createTradePerformance(
          runtime,
          rec.contractAddress,
          userId,
          {
            buy_amount: rec.buyAmount,
            is_simulation: true
          }
        );
        break;
      case "sell":
      case "dont_sell":
      case "dont_buy":
        elizaLogger6.warn("Not implemented");
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

// src/actions/transfer.ts
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction
} from "@solana/spl-token";
import { elizaLogger as elizaLogger7, settings as settings3 } from "@elizaos/core";
import {
  Connection as Connection6,
  PublicKey as PublicKey5,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";
import {
  ModelClass as ModelClass2
} from "@elizaos/core";
import { composeContext as composeContext2 } from "@elizaos/core";
import { generateObjectDeprecated } from "@elizaos/core";
function isTransferContent(runtime, content) {
  elizaLogger7.log("Content for transfer", content);
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

Extract the following information about the requested token transfer:
- Token contract address
- Recipient wallet address
- Amount to transfer

If no token address is mentioned, respond with null.
`;
var transfer_default = {
  name: "SEND_TOKEN",
  similes: ["TRANSFER_TOKEN", "TRANSFER_TOKENS", "SEND_TOKENS", "PAY_TOKEN", "PAY_TOKENS", "PAY"],
  validate: async (runtime, message) => {
    elizaLogger7.log("Validating token transfer from user:", message.userId);
    return true;
  },
  description: "Transfer SPL tokens from agent's wallet to another address",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger7.log("Starting SEND_TOKEN handler...");
    if (!state) {
      state = await runtime.composeState(message);
    } else {
      state = await runtime.updateRecentMessageState(state);
    }
    const transferContext = composeContext2({
      state,
      template: transferTemplate
    });
    const content = await generateObjectDeprecated({
      runtime,
      context: transferContext,
      modelClass: ModelClass2.LARGE
    });
    if (!isTransferContent(runtime, content)) {
      if (callback) {
        callback({
          text: "Token address needed to send the token.",
          content: { error: "Invalid transfer content" }
        });
      }
      return false;
    }
    try {
      const { keypair: senderKeypair } = await getWalletKey(runtime, true);
      const connection3 = new Connection6(settings3.SOLANA_RPC_URL);
      const mintPubkey = new PublicKey5(content.tokenAddress);
      const recipientPubkey = new PublicKey5(content.recipient);
      const mintInfo = await connection3.getParsedAccountInfo(mintPubkey);
      const decimals = mintInfo.value?.data?.parsed?.info?.decimals ?? 9;
      const adjustedAmount = BigInt(Number(content.amount) * Math.pow(10, decimals));
      const senderATA = getAssociatedTokenAddressSync(mintPubkey, senderKeypair.publicKey);
      const recipientATA = getAssociatedTokenAddressSync(mintPubkey, recipientPubkey);
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
      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([senderKeypair]);
      const signature = await connection3.sendTransaction(transaction);
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
      return true;
    } catch (error) {
      elizaLogger7.error("Error during token transfer:", error);
      if (callback) {
        callback({
          text: `Issue with the transfer: ${error.message}`,
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
          text: "Sending the tokens now...",
          action: "SEND_TOKEN"
        }
      }
    ]
  ]
};

// src/actions/transfer_sol.ts
import { elizaLogger as elizaLogger8, settings as settings4 } from "@elizaos/core";
import {
  Connection as Connection7,
  PublicKey as PublicKey6,
  SystemProgram,
  TransactionMessage as TransactionMessage2,
  VersionedTransaction as VersionedTransaction2
} from "@solana/web3.js";
import {
  ModelClass as ModelClass3
} from "@elizaos/core";
import { composeContext as composeContext3 } from "@elizaos/core";
import { generateObjectDeprecated as generateObjectDeprecated2 } from "@elizaos/core";
function isSolTransferContent(content) {
  return typeof content.recipient === "string" && typeof content.amount === "number";
}
var solTransferTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "recipient": "9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa",
    "amount": 1.5
}
\`\`\`

{{recentMessages}}

Extract the following information about the requested SOL transfer:
- Recipient wallet address
- Amount of SOL to transfer
`;
var transfer_sol_default = {
  name: "SEND_SOL",
  similes: ["TRANSFER_SOL", "PAY_SOL", "TRANSACT_SOL"],
  validate: async (runtime, message) => {
    elizaLogger8.log("Validating SOL transfer from user:", message.userId);
    return true;
  },
  description: "Transfer native SOL from agent's wallet to specified address",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger8.log("Starting SEND_SOL handler...");
    if (!state) {
      state = await runtime.composeState(message);
    } else {
      state = await runtime.updateRecentMessageState(state);
    }
    const transferContext = composeContext3({
      state,
      template: solTransferTemplate
    });
    const content = await generateObjectDeprecated2({
      runtime,
      context: transferContext,
      modelClass: ModelClass3.LARGE
    });
    if (!isSolTransferContent(content)) {
      if (callback) {
        callback({
          text: "Need an address and the amount of SOL to send.",
          content: { error: "Invalid transfer content" }
        });
      }
      return false;
    }
    try {
      const { keypair: senderKeypair } = await getWalletKey(runtime, true);
      const connection3 = new Connection7(settings4.SOLANA_RPC_URL);
      const recipientPubkey = new PublicKey6(content.recipient);
      const lamports = content.amount * 1e9;
      const instruction = SystemProgram.transfer({
        fromPubkey: senderKeypair.publicKey,
        toPubkey: recipientPubkey,
        lamports
      });
      const messageV0 = new TransactionMessage2({
        payerKey: senderKeypair.publicKey,
        recentBlockhash: (await connection3.getLatestBlockhash()).blockhash,
        instructions: [instruction]
      }).compileToV0Message();
      const transaction = new VersionedTransaction2(messageV0);
      transaction.sign([senderKeypair]);
      const signature = await connection3.sendTransaction(transaction);
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
      return true;
    } catch (error) {
      elizaLogger8.error("Error during SOL transfer:", error);
      if (callback) {
        callback({
          text: `Problem with the SOL transfer: ${error.message}`,
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
          text: "Send 1.5 SOL to 9jW8FPr6BSSsemWPV22UUCzSqkVdTp6HTyPqeqyuBbCa"
        }
      },
      {
        user: "{{user2}}",
        content: {
          text: "Sure thing, SOL on its way.",
          action: "SEND_SOL"
        }
      }
    ]
  ]
};

// src/providers/tokenUtils.ts
import { getAccount, getAssociatedTokenAddress as getAssociatedTokenAddress2 } from "@solana/spl-token";
import { PublicKey as PublicKey7 } from "@solana/web3.js";
import { elizaLogger as elizaLogger9 } from "@elizaos/core";
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
    elizaLogger9.error(
      `Error retrieving balance for token: ${tokenMintAddress.toBase58()}`,
      error
    );
    return 0;
  }
}
async function getTokenBalances(connection3, walletPublicKey) {
  const tokenBalances = {};
  const tokenMintAddresses = [
    new PublicKey7("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    // USDC
    new PublicKey7("So11111111111111111111111111111111111111112")
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

// src/actions/swap.ts
import {
  composeContext as composeContext4,
  generateObjectDeprecated as generateObjectDeprecated3,
  ModelClass as ModelClass4,
  settings as settings6,
  elizaLogger as elizaLogger11
} from "@elizaos/core";
import { Connection as Connection9, VersionedTransaction as VersionedTransaction4 } from "@solana/web3.js";
import BigNumber3 from "bignumber.js";

// src/actions/swapUtils.ts
import { getAssociatedTokenAddress as getAssociatedTokenAddress3 } from "@solana/spl-token";
import {
  Connection as Connection8,
  PublicKey as PublicKey8,
  VersionedTransaction as VersionedTransaction3
} from "@solana/web3.js";
import { settings as settings5, elizaLogger as elizaLogger10 } from "@elizaos/core";
var solAddress = settings5.SOL_ADDRESS;
var SLIPPAGE = settings5.SLIPPAGE;
var connection2 = new Connection8(
  settings5.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com"
);
async function getTokenDecimals(connection3, mintAddress) {
  const mintPublicKey = new PublicKey8(mintAddress);
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
    const decimals = inputTokenCA === settings6.SOL_ADDRESS ? new BigNumber3(9) : new BigNumber3(
      await getTokenDecimals(connection3, inputTokenCA)
    );
    elizaLogger11.log("Decimals:", decimals.toString());
    const amountBN = new BigNumber3(amount);
    const adjustedAmount = amountBN.multipliedBy(
      new BigNumber3(10).pow(decimals)
    );
    elizaLogger11.log("Fetching quote with params:", {
      inputMint: inputTokenCA,
      outputMint: outputTokenCA,
      amount: adjustedAmount
    });
    const quoteResponse = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputTokenCA}&outputMint=${outputTokenCA}&amount=${adjustedAmount}&dynamicSlippage=true&maxAccounts=64`
    );
    const quoteData = await quoteResponse.json();
    if (!quoteData || quoteData.error) {
      elizaLogger11.error("Quote error:", quoteData);
      throw new Error(
        `Failed to get quote: ${quoteData?.error || "Unknown error"}`
      );
    }
    elizaLogger11.log("Quote received:", quoteData);
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
    elizaLogger11.log("Requesting swap with body:", swapRequestBody);
    const swapResponse = await fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(swapRequestBody)
    });
    const swapData = await swapResponse.json();
    if (!swapData || !swapData.swapTransaction) {
      elizaLogger11.error("Swap error:", swapData);
      throw new Error(
        `Failed to get swap transaction: ${swapData?.error || "No swap transaction returned"}`
      );
    }
    elizaLogger11.log("Swap transaction received");
    return swapData;
  } catch (error) {
    elizaLogger11.error("Error in swapToken:", error);
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
    new Connection9("https://api.mainnet-beta.solana.com"),
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
    elizaLogger11.error("Error checking token in wallet:", error);
    return null;
  }
}
var executeSwap = {
  name: "EXECUTE_SWAP",
  similes: ["SWAP_TOKENS", "TOKEN_SWAP", "TRADE_TOKENS", "EXCHANGE_TOKENS"],
  validate: async (runtime, message) => {
    elizaLogger11.log("Message:", message);
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
    const swapContext = composeContext4({
      state,
      template: swapTemplate
    });
    const response = await generateObjectDeprecated3({
      runtime,
      context: swapContext,
      modelClass: ModelClass4.LARGE
    });
    elizaLogger11.log("Response:", response);
    if (response.inputTokenSymbol?.toUpperCase() === "SOL") {
      response.inputTokenCA = settings6.SOL_ADDRESS;
    }
    if (response.outputTokenSymbol?.toUpperCase() === "SOL") {
      response.outputTokenCA = settings6.SOL_ADDRESS;
    }
    if (!response.inputTokenCA && response.inputTokenSymbol) {
      elizaLogger11.log(
        `Attempting to resolve CA for input token symbol: ${response.inputTokenSymbol}`
      );
      response.inputTokenCA = await getTokenFromWallet(
        runtime,
        response.inputTokenSymbol
      );
      if (response.inputTokenCA) {
        elizaLogger11.log(
          `Resolved inputTokenCA: ${response.inputTokenCA}`
        );
      } else {
        elizaLogger11.log(
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
      elizaLogger11.log(
        `Attempting to resolve CA for output token symbol: ${response.outputTokenSymbol}`
      );
      response.outputTokenCA = await getTokenFromWallet(
        runtime,
        response.outputTokenSymbol
      );
      if (response.outputTokenCA) {
        elizaLogger11.log(
          `Resolved outputTokenCA: ${response.outputTokenCA}`
        );
      } else {
        elizaLogger11.log(
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
      elizaLogger11.log("No amount provided, skipping swap");
      const responseMsg = {
        text: "I need the amount to perform the swap"
      };
      callback?.(responseMsg);
      return true;
    }
    if (!response.amount) {
      elizaLogger11.log("Amount is not a number, skipping swap");
      const responseMsg = {
        text: "The amount must be a number"
      };
      callback?.(responseMsg);
      return true;
    }
    try {
      const connection3 = new Connection9(
        "https://api.mainnet-beta.solana.com"
      );
      const { publicKey: walletPublicKey } = await getWalletKey(
        runtime,
        false
      );
      elizaLogger11.log("Wallet Public Key:", walletPublicKey);
      elizaLogger11.log("inputTokenSymbol:", response.inputTokenCA);
      elizaLogger11.log("outputTokenSymbol:", response.outputTokenCA);
      elizaLogger11.log("amount:", response.amount);
      const swapResult = await swapToken(
        connection3,
        walletPublicKey,
        response.inputTokenCA,
        response.outputTokenCA,
        response.amount
      );
      elizaLogger11.log("Deserializing transaction...");
      const transactionBuf = Buffer.from(
        swapResult.swapTransaction,
        "base64"
      );
      const transaction = VersionedTransaction4.deserialize(transactionBuf);
      elizaLogger11.log("Preparing to sign transaction...");
      elizaLogger11.log("Creating keypair...");
      const { keypair } = await getWalletKey(runtime, true);
      if (keypair.publicKey.toBase58() !== walletPublicKey.toBase58()) {
        throw new Error(
          "Generated public key doesn't match expected public key"
        );
      }
      elizaLogger11.log("Signing transaction...");
      transaction.sign([keypair]);
      elizaLogger11.log("Sending transaction...");
      const latestBlockhash = await connection3.getLatestBlockhash();
      const txid = await connection3.sendTransaction(transaction, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: "confirmed"
      });
      elizaLogger11.log("Transaction sent:", txid);
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
      elizaLogger11.log("Swap completed successfully!");
      elizaLogger11.log(`Transaction ID: ${txid}`);
      const responseMsg = {
        text: `Swap completed successfully! Transaction ID: ${txid}`
      };
      callback?.(responseMsg);
      return true;
    } catch (error) {
      elizaLogger11.error("Error during token swap:", error);
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
  ModelClass as ModelClass5,
  composeContext as composeContext5,
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
    const context = composeContext5({
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
      modelClass: ModelClass5.LARGE
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
import { generateImage, elizaLogger as elizaLogger12 } from "@elizaos/core";
import { Connection as Connection10, Keypair as Keypair2 } from "@solana/web3.js";
import { VersionedTransaction as VersionedTransaction5 } from "@solana/web3.js";
import { Fomo } from "fomo-sdk-solana";
import { getAssociatedTokenAddressSync as getAssociatedTokenAddressSync2 } from "@solana/spl-token";
import bs582 from "bs58";
import {
  settings as settings7,
  ModelClass as ModelClass6,
  generateObject,
  composeContext as composeContext6
} from "@elizaos/core";
function isCreateAndBuyContentForFomo(content) {
  elizaLogger12.log("Content for create & buy", content);
  return typeof content.tokenMetadata === "object" && content.tokenMetadata !== null && typeof content.tokenMetadata.name === "string" && typeof content.tokenMetadata.symbol === "string" && typeof content.tokenMetadata.description === "string" && typeof content.tokenMetadata.image_description === "string" && (typeof content.buyAmountSol === "string" || typeof content.buyAmountSol === "number") && typeof content.requiredLiquidity === "number";
}
var createAndBuyToken = async ({
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
  const deserializedTx = VersionedTransaction5.deserialize(
    Buffer.from(serializedTransactionBase64, "base64")
  );
  const txid = await connection3.sendTransaction(deserializedTx, {
    skipPreflight: false,
    maxRetries: 3,
    preflightCommitment: "confirmed"
  });
  elizaLogger12.log("Transaction sent:", txid);
  const confirmation = await connection3.confirmTransaction(
    {
      signature: txid,
      blockhash,
      lastValidBlockHeight
    },
    commitment
  );
  if (!confirmation.value.err) {
    elizaLogger12.log(
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
      elizaLogger12.log(
        `${deployer.publicKey.toBase58()}:`,
        "No Account Found"
      );
    } else {
      elizaLogger12.log(`${deployer.publicKey.toBase58()}:`, amount);
    }
    return {
      success: true,
      ca: mint.publicKey.toBase58(),
      creator: deployer.publicKey.toBase58()
    };
  } else {
    elizaLogger12.log("Create and Buy failed");
    return {
      success: false,
      ca: mint.publicKey.toBase58(),
      error: confirmation.value.err || "Transaction failed"
    };
  }
};
var promptConfirmation = async () => {
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
var pumpfun_default = {
  name: "CREATE_AND_BUY_TOKEN",
  similes: ["CREATE_AND_PURCHASE_TOKEN", "DEPLOY_AND_BUY_TOKEN"],
  validate: async (_runtime, _message) => {
    return true;
  },
  description: "Create a new token and buy a specified amount using SOL. Requires deployer private key, token metadata, buy amount in SOL, priority fee, and allowOffCurve flag.",
  handler: async (runtime, message, state, _options, callback) => {
    elizaLogger12.log("Starting CREATE_AND_BUY_TOKEN handler...");
    if (!state) {
      state = await runtime.composeState(message);
    } else {
      state = await runtime.updateRecentMessageState(state);
    }
    const walletInfo = await walletProvider.get(runtime, message, state);
    state.walletInfo = walletInfo;
    const pumpContext = composeContext6({
      state,
      template: fomoTemplate
    });
    const content = await generateObject({
      runtime,
      context: pumpContext,
      modelClass: ModelClass6.LARGE
    });
    if (!isCreateAndBuyContentForFomo(content)) {
      elizaLogger12.error(
        "Invalid content for CREATE_AND_BUY_TOKEN action."
      );
      return false;
    }
    const { tokenMetadata, buyAmountSol, requiredLiquidity } = content;
    const imageResult = await generateImage(
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
      const privateKeyString = runtime.getSetting("SOLANA_PRIVATE_KEY") ?? runtime.getSetting("WALLET_PRIVATE_KEY");
      const secretKey = bs582.decode(privateKeyString);
      const deployerKeypair = Keypair2.fromSecretKey(secretKey);
      const mintKeypair = Keypair2.generate();
      elizaLogger12.log(
        `Generated mint address: ${mintKeypair.publicKey.toBase58()}`
      );
      const connection3 = new Connection10(settings7.SOLANA_RPC_URL, {
        commitment: "confirmed",
        confirmTransactionInitialTimeout: 5e5,
        wsEndpoint: settings7.SOLANA_RPC_URL.replace("https", "wss")
      });
      const sdk = new Fomo(connection3, "devnet", deployerKeypair);
      const createAndBuyConfirmation = await promptConfirmation();
      if (!createAndBuyConfirmation) {
        elizaLogger12.log("Create and buy token canceled by user");
        return false;
      }
      const lamports = Math.floor(Number(buyAmountSol) * 1e9);
      elizaLogger12.log("Executing create and buy transaction...");
      const result = await createAndBuyToken({
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
      elizaLogger12.log(successMessage);
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

// src/actions/fomo.ts
import { generateImage as generateImage2, elizaLogger as elizaLogger13 } from "@elizaos/core";
import {
  Connection as Connection11,
  Keypair as Keypair3,
  VersionedTransaction as VersionedTransaction6
} from "@solana/web3.js";
import { Fomo as Fomo2 } from "fomo-sdk-solana";
import { getAssociatedTokenAddressSync as getAssociatedTokenAddressSync3 } from "@solana/spl-token";
import bs583 from "bs58";
import {
  settings as settings8,
  ModelClass as ModelClass7,
  generateObject as generateObject2,
  composeContext as composeContext7
} from "@elizaos/core";
function isCreateAndBuyContentForFomo2(content) {
  elizaLogger13.log("Content for create & buy", content);
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
    bs583.encode(mint.secretKey),
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
  const deserializedTx = VersionedTransaction6.deserialize(
    Buffer.from(serializedTransactionBase64, "base64")
  );
  const txid = await connection3.sendTransaction(deserializedTx, {
    skipPreflight: false,
    maxRetries: 3,
    preflightCommitment: "confirmed"
  });
  elizaLogger13.log("Transaction sent:", txid);
  const confirmation = await connection3.confirmTransaction(
    {
      signature: txid,
      blockhash,
      lastValidBlockHeight
    },
    commitment
  );
  if (!confirmation.value.err) {
    elizaLogger13.log(
      "Success:",
      `https://fomo.fund/token/${mint.publicKey.toBase58()}`
    );
    const ata = getAssociatedTokenAddressSync3(
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
      elizaLogger13.log(
        `${deployer.publicKey.toBase58()}:`,
        "No Account Found"
      );
    } else {
      elizaLogger13.log(`${deployer.publicKey.toBase58()}:`, amount);
    }
    return {
      success: true,
      ca: mint.publicKey.toBase58(),
      creator: deployer.publicKey.toBase58()
    };
  } else {
    elizaLogger13.log("Create and Buy failed");
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
var fomoTemplate2 = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

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
    elizaLogger13.log("Starting CREATE_AND_BUY_TOKEN handler...");
    if (!state) {
      state = await runtime.composeState(message);
    } else {
      state = await runtime.updateRecentMessageState(state);
    }
    const walletInfo = await walletProvider.get(runtime, message, state);
    state.walletInfo = walletInfo;
    const pumpContext = composeContext7({
      state,
      template: fomoTemplate2
    });
    const content = await generateObject2({
      runtime,
      context: pumpContext,
      modelClass: ModelClass7.LARGE
    });
    if (!isCreateAndBuyContentForFomo2(content)) {
      elizaLogger13.error(
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
      const privateKeyString = runtime.getSetting("SOLANA_PRIVATE_KEY") ?? runtime.getSetting("WALLET_PRIVATE_KEY");
      const secretKey = bs583.decode(privateKeyString);
      const deployerKeypair = Keypair3.fromSecretKey(secretKey);
      const mintKeypair = Keypair3.generate();
      elizaLogger13.log(
        `Generated mint address: ${mintKeypair.publicKey.toBase58()}`
      );
      const connection3 = new Connection11(settings8.SOLANA_RPC_URL, {
        commitment: "confirmed",
        confirmTransactionInitialTimeout: 5e5,
        // 120 seconds
        wsEndpoint: settings8.SOLANA_RPC_URL.replace("https", "wss")
      });
      const sdk = new Fomo2(connection3, "devnet", deployerKeypair);
      const createAndBuyConfirmation = await promptConfirmation2();
      if (!createAndBuyConfirmation) {
        elizaLogger13.log("Create and buy token canceled by user");
        return false;
      }
      const lamports = Math.floor(Number(buyAmountSol) * 1e9);
      elizaLogger13.log("Executing create and buy transaction...");
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
      elizaLogger13.log(successMessage);
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
  elizaLogger as elizaLogger14
} from "@elizaos/core";
import { Connection as Connection12, PublicKey as PublicKey9, Transaction } from "@solana/web3.js";
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
    programId: new PublicKey9("PROGRAM_ID"),
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
    elizaLogger14.log("Message:", message);
    return true;
  },
  description: "Perform a DAO token swap using execute_invoke.",
  handler: async (runtime, message) => {
    const { inputToken, outputToken, amount } = message.content;
    try {
      const connection3 = new Connection12(
        runtime.getSetting("SOLANA_RPC_URL")
      );
      const { keypair: authority } = await getWalletKey(runtime, true);
      const daoMint = new PublicKey9(runtime.getSetting("DAO_MINT"));
      const [statePDA] = await PublicKey9.findProgramAddress(
        [Buffer.from("state"), daoMint.toBuffer()],
        authority.publicKey
      );
      const [walletPDA] = await PublicKey9.findProgramAddress(
        [Buffer.from("wallet"), daoMint.toBuffer()],
        authority.publicKey
      );
      const quoteData = await getQuote(
        connection3,
        inputToken,
        outputToken,
        amount
      );
      elizaLogger14.log("Swap Quote:", quoteData);
      const confirmSwap = await promptConfirmation3();
      if (!confirmSwap) {
        elizaLogger14.log("Swap canceled by user");
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
      elizaLogger14.log("DAO Swap completed successfully!");
      elizaLogger14.log(`Transaction ID: ${txid}`);
      return true;
    } catch (error) {
      elizaLogger14.error("Error during DAO token swap:", error);
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

// src/index.ts
var solanaPlugin = {
  name: "solana",
  description: "Solana Plugin for Eliza",
  actions: [
    transfer_default,
    transfer_sol_default,
    executeSwap,
    pumpfun_default,
    fomo_default,
    executeSwapForDAO,
    takeOrder_default
  ],
  evaluators: [trustEvaluator],
  providers: [walletProvider, trustScoreProvider]
};
var index_default = solanaPlugin;
export {
  TokenProvider,
  TrustScoreManager,
  WalletProvider,
  index_default as default,
  formatRecommendations,
  getTokenBalance,
  getTokenBalances,
  solanaPlugin,
  tokenProvider,
  trustEvaluator,
  trustScoreProvider,
  walletProvider
};
//# sourceMappingURL=index.js.map
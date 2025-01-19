import { ICacheManager, IAgentRuntime, Plugin } from '@elizaos/core';
import { Connection, PublicKey } from '@solana/web3.js';

interface TokenSecurityData {
    ownerBalance: string;
    creatorBalance: string;
    ownerPercentage: number;
    creatorPercentage: number;
    top10HolderBalance: string;
    top10HolderPercent: number;
}
interface TokenCodex {
    id: string;
    address: string;
    cmcId: number;
    decimals: number;
    name: string;
    symbol: string;
    totalSupply: string;
    circulatingSupply: string;
    imageThumbUrl: string;
    blueCheckmark: boolean;
    isScam: boolean;
}
interface TokenTradeData {
    address: string;
    holder: number;
    market: number;
    last_trade_unix_time: number;
    last_trade_human_time: string;
    price: number;
    history_30m_price: number;
    price_change_30m_percent: number;
    history_1h_price: number;
    price_change_1h_percent: number;
    history_2h_price: number;
    price_change_2h_percent: number;
    history_4h_price: number;
    price_change_4h_percent: number;
    history_6h_price: number;
    price_change_6h_percent: number;
    history_8h_price: number;
    price_change_8h_percent: number;
    history_12h_price: number;
    price_change_12h_percent: number;
    history_24h_price: number;
    price_change_24h_percent: number;
    unique_wallet_30m: number;
    unique_wallet_history_30m: number;
    unique_wallet_30m_change_percent: number;
    unique_wallet_1h: number;
    unique_wallet_history_1h: number;
    unique_wallet_1h_change_percent: number;
    unique_wallet_2h: number;
    unique_wallet_history_2h: number;
    unique_wallet_2h_change_percent: number;
    unique_wallet_4h: number;
    unique_wallet_history_4h: number;
    unique_wallet_4h_change_percent: number;
    unique_wallet_8h: number;
    unique_wallet_history_8h: number | null;
    unique_wallet_8h_change_percent: number | null;
    unique_wallet_24h: number;
    unique_wallet_history_24h: number | null;
    unique_wallet_24h_change_percent: number | null;
    trade_30m: number;
    trade_history_30m: number;
    trade_30m_change_percent: number;
    sell_30m: number;
    sell_history_30m: number;
    sell_30m_change_percent: number;
    buy_30m: number;
    buy_history_30m: number;
    buy_30m_change_percent: number;
    volume_30m: number;
    volume_30m_usd: number;
    volume_history_30m: number;
    volume_history_30m_usd: number;
    volume_30m_change_percent: number;
    volume_buy_30m: number;
    volume_buy_30m_usd: number;
    volume_buy_history_30m: number;
    volume_buy_history_30m_usd: number;
    volume_buy_30m_change_percent: number;
    volume_sell_30m: number;
    volume_sell_30m_usd: number;
    volume_sell_history_30m: number;
    volume_sell_history_30m_usd: number;
    volume_sell_30m_change_percent: number;
    trade_1h: number;
    trade_history_1h: number;
    trade_1h_change_percent: number;
    sell_1h: number;
    sell_history_1h: number;
    sell_1h_change_percent: number;
    buy_1h: number;
    buy_history_1h: number;
    buy_1h_change_percent: number;
    volume_1h: number;
    volume_1h_usd: number;
    volume_history_1h: number;
    volume_history_1h_usd: number;
    volume_1h_change_percent: number;
    volume_buy_1h: number;
    volume_buy_1h_usd: number;
    volume_buy_history_1h: number;
    volume_buy_history_1h_usd: number;
    volume_buy_1h_change_percent: number;
    volume_sell_1h: number;
    volume_sell_1h_usd: number;
    volume_sell_history_1h: number;
    volume_sell_history_1h_usd: number;
    volume_sell_1h_change_percent: number;
    trade_2h: number;
    trade_history_2h: number;
    trade_2h_change_percent: number;
    sell_2h: number;
    sell_history_2h: number;
    sell_2h_change_percent: number;
    buy_2h: number;
    buy_history_2h: number;
    buy_2h_change_percent: number;
    volume_2h: number;
    volume_2h_usd: number;
    volume_history_2h: number;
    volume_history_2h_usd: number;
    volume_2h_change_percent: number;
    volume_buy_2h: number;
    volume_buy_2h_usd: number;
    volume_buy_history_2h: number;
    volume_buy_history_2h_usd: number;
    volume_buy_2h_change_percent: number;
    volume_sell_2h: number;
    volume_sell_2h_usd: number;
    volume_sell_history_2h: number;
    volume_sell_history_2h_usd: number;
    volume_sell_2h_change_percent: number;
    trade_4h: number;
    trade_history_4h: number;
    trade_4h_change_percent: number;
    sell_4h: number;
    sell_history_4h: number;
    sell_4h_change_percent: number;
    buy_4h: number;
    buy_history_4h: number;
    buy_4h_change_percent: number;
    volume_4h: number;
    volume_4h_usd: number;
    volume_history_4h: number;
    volume_history_4h_usd: number;
    volume_4h_change_percent: number;
    volume_buy_4h: number;
    volume_buy_4h_usd: number;
    volume_buy_history_4h: number;
    volume_buy_history_4h_usd: number;
    volume_buy_4h_change_percent: number;
    volume_sell_4h: number;
    volume_sell_4h_usd: number;
    volume_sell_history_4h: number;
    volume_sell_history_4h_usd: number;
    volume_sell_4h_change_percent: number;
    trade_8h: number;
    trade_history_8h: number | null;
    trade_8h_change_percent: number | null;
    sell_8h: number;
    sell_history_8h: number | null;
    sell_8h_change_percent: number | null;
    buy_8h: number;
    buy_history_8h: number | null;
    buy_8h_change_percent: number | null;
    volume_8h: number;
    volume_8h_usd: number;
    volume_history_8h: number;
    volume_history_8h_usd: number;
    volume_8h_change_percent: number | null;
    volume_buy_8h: number;
    volume_buy_8h_usd: number;
    volume_buy_history_8h: number;
    volume_buy_history_8h_usd: number;
    volume_buy_8h_change_percent: number | null;
    volume_sell_8h: number;
    volume_sell_8h_usd: number;
    volume_sell_history_8h: number;
    volume_sell_history_8h_usd: number;
    volume_sell_8h_change_percent: number | null;
    trade_24h: number;
    trade_history_24h: number;
    trade_24h_change_percent: number | null;
    sell_24h: number;
    sell_history_24h: number;
    sell_24h_change_percent: number | null;
    buy_24h: number;
    buy_history_24h: number;
    buy_24h_change_percent: number | null;
    volume_24h: number;
    volume_24h_usd: number;
    volume_history_24h: number;
    volume_history_24h_usd: number;
    volume_24h_change_percent: number | null;
    volume_buy_24h: number;
    volume_buy_24h_usd: number;
    volume_buy_history_24h: number;
    volume_buy_history_24h_usd: number;
    volume_buy_24h_change_percent: number | null;
    volume_sell_24h: number;
    volume_sell_24h_usd: number;
    volume_sell_history_24h: number;
    volume_sell_history_24h_usd: number;
    volume_sell_24h_change_percent: number | null;
}
interface HolderData {
    address: string;
    balance: string;
}
interface ProcessedTokenData {
    security: TokenSecurityData;
    tradeData: TokenTradeData;
    holderDistributionTrend: string;
    highValueHolders: Array<{
        holderAddress: string;
        balanceUsd: string;
    }>;
    recentTrades: boolean;
    highSupplyHoldersCount: number;
    dexScreenerData: DexScreenerData;
    isDexScreenerListed: boolean;
    isDexScreenerPaid: boolean;
    tokenCodex: TokenCodex;
}
interface DexScreenerPair {
    chainId: string;
    dexId: string;
    url: string;
    pairAddress: string;
    baseToken: {
        address: string;
        name: string;
        symbol: string;
    };
    quoteToken: {
        address: string;
        name: string;
        symbol: string;
    };
    priceNative: string;
    priceUsd: string;
    txns: {
        m5: {
            buys: number;
            sells: number;
        };
        h1: {
            buys: number;
            sells: number;
        };
        h6: {
            buys: number;
            sells: number;
        };
        h24: {
            buys: number;
            sells: number;
        };
    };
    volume: {
        h24: number;
        h6: number;
        h1: number;
        m5: number;
    };
    priceChange: {
        m5: number;
        h1: number;
        h6: number;
        h24: number;
    };
    liquidity: {
        usd: number;
        base: number;
        quote: number;
    };
    fdv: number;
    marketCap: number;
    pairCreatedAt: number;
    info: {
        imageUrl: string;
        websites: {
            label: string;
            url: string;
        }[];
        socials: {
            type: string;
            url: string;
        }[];
    };
    boosts: {
        active: number;
    };
}
interface DexScreenerData {
    schemaVersion: string;
    pairs: DexScreenerPair[];
}
interface Prices$1 {
    solana: {
        usd: string;
    };
    bitcoin: {
        usd: string;
    };
    ethereum: {
        usd: string;
    };
}
interface CalculatedBuyAmounts {
    none: 0;
    low: number;
    medium: number;
    high: number;
}

interface Item {
    name: string;
    address: string;
    symbol: string;
    decimals: number;
    balance: string;
    uiAmount: string;
    priceUsd: string;
    valueUsd: string;
    valueSol?: string;
}
interface WalletPortfolio {
    totalUsd: string;
    totalSol?: string;
    items: Array<Item>;
}
interface Prices {
    solana: {
        usd: string;
    };
    bitcoin: {
        usd: string;
    };
    ethereum: {
        usd: string;
    };
}
declare class WalletProvider {
    private connection;
    private walletPublicKey;
    private cache;
    constructor(connection: Connection, walletPublicKey: PublicKey);
    private fetchWithRetry;
    fetchPortfolioValue(runtime: any): Promise<WalletPortfolio>;
    fetchPortfolioValueCodex(runtime: any): Promise<WalletPortfolio>;
    fetchPrices(runtime: any): Promise<Prices>;
    formatPortfolio(runtime: any, portfolio: WalletPortfolio, prices: Prices): string;
    getFormattedPortfolio(runtime: any): Promise<string>;
    private getTokenAccounts;
}

declare class TokenProvider {
    private tokenAddress;
    private walletProvider;
    private cacheManager;
    private cache;
    private cacheKey;
    private NETWORK_ID;
    private GRAPHQL_ENDPOINT;
    constructor(tokenAddress: string, walletProvider: WalletProvider, cacheManager: ICacheManager);
    private readFromCache;
    private writeToCache;
    private getCachedData;
    private setCachedData;
    private fetchWithRetry;
    getTokensInWallet(runtime: IAgentRuntime): Promise<Item[]>;
    getTokenFromWallet(runtime: IAgentRuntime, tokenSymbol: string): Promise<string>;
    fetchTokenCodex(): Promise<TokenCodex>;
    fetchPrices(): Promise<Prices$1>;
    calculateBuyAmounts(): Promise<CalculatedBuyAmounts>;
    fetchTokenSecurity(): Promise<TokenSecurityData>;
    fetchTokenTradeData(): Promise<TokenTradeData>;
    fetchDexScreenerData(): Promise<DexScreenerData>;
    searchDexScreenerData(symbol: string): Promise<DexScreenerPair | null>;
    getHighestLiquidityPair(dexData: DexScreenerData): DexScreenerPair | null;
    analyzeHolderDistribution(tradeData: TokenTradeData): Promise<string>;
    fetchHolderList(): Promise<HolderData[]>;
    filterHighValueHolders(tradeData: TokenTradeData): Promise<Array<{
        holderAddress: string;
        balanceUsd: string;
    }>>;
    checkRecentTrades(tradeData: TokenTradeData): Promise<boolean>;
    countHighSupplyHolders(securityData: TokenSecurityData): Promise<number>;
    getProcessedTokenData(): Promise<ProcessedTokenData>;
    shouldTradeToken(): Promise<boolean>;
    formatTokenData(data: ProcessedTokenData): string;
    getFormattedTokenReport(): Promise<string>;
}

declare function getTokenBalance(connection: Connection, walletPublicKey: PublicKey, tokenMintAddress: PublicKey): Promise<number>;
declare function getTokenBalances(connection: Connection, walletPublicKey: PublicKey): Promise<{
    [tokenName: string]: number;
}>;

declare const solanaPlugin: Plugin;

export { TokenProvider, WalletProvider, solanaPlugin as default, getTokenBalance, getTokenBalances, solanaPlugin };

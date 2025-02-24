import { elizaLogger, IAgentRuntime, Provider } from "@elizaos/core";
import { StakePoolsType, StakeProtocolData } from "../types/stake";

// Provider configuration for retry mechanism and caching
const PROVIDER_CONFIG = {
    MAX_RETRIES: 3, // Maximum number of retry attempts for failed requests
    RETRY_DELAY: 2000, // Delay between retries in milliseconds
    CACHE_TTL: 300, // Cache time-to-live in seconds (5 minutes)
};

/**
 * Class responsible for fetching and managing stake pool information
 * Implements caching and retry mechanisms for reliable data fetching
 */
export class StakeProtocolProvider {
    /**
     * Fetches data from a URL with retry mechanism
     * @param url - The URL to fetch data from
     * @param options - Optional fetch configuration
     * @returns Promise resolving to the parsed JSON response
     */
    private async fetchWithRetry(
        url: string,
        options: RequestInit = {}
    ): Promise<unknown> {
        let lastError: unknown;
        for (let i = 0; i < PROVIDER_CONFIG.MAX_RETRIES; i++) {
            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    elizaLogger.error("HTTP error:", response);
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return await response.json();
            } catch (error) {
                lastError = error;
                elizaLogger.error("Error fetching data:", error);
                await new Promise((resolve) =>
                    setTimeout(resolve, PROVIDER_CONFIG.RETRY_DELAY)
                );
            }
        }
        throw lastError;
    }

    private async fetchPoolList(
        runtime: IAgentRuntime
    ): Promise<StakePoolsType> {
        const requestBaseUrl =
            runtime.getSetting("STAKE_POOL_REQUEST_BASE_URL") ??
            "https://eliza-provider-api.stafi.io";
        const data = (await this.fetchWithRetry(
            `${requestBaseUrl}/api/stake-pool-list`
        )) as StakePoolsType;

        elizaLogger.log("Pool List:", JSON.stringify(data, null, 2));

        return data;
    }

    /**
     * Fetches comprehensive pool data from all supported protocols
     * Implements caching to avoid frequent API calls
     * @returns Promise<StakeProtocolData> containing pool information and timestamp
     */
    private async fetchPoolData(
        runtime: IAgentRuntime
    ): Promise<StakeProtocolData> {
        const requestBaseUrl =
            runtime.getSetting("STAKE_POOL_REQUEST_BASE_URL") ??
            "https://eliza-provider-api.stafi.io";

        const data = (await this.fetchWithRetry(
            `${requestBaseUrl}/api/stake-pool-info`
        )) as StakeProtocolData;

        elizaLogger.log("Stake Pool Info:", JSON.stringify(data, null, 2));

        return data;
    }

    /**
     * Public method to retrieve stake pool information
     * @returns Promise<StakeProtocolData> with current pool data
     */
    async getStakePoolInfo(runtime: IAgentRuntime): Promise<StakeProtocolData> {
        return await this.fetchPoolData(runtime);
    }

    async getStakePoolList(runtime: IAgentRuntime): Promise<StakePoolsType> {
        return await this.fetchPoolList(runtime);
    }
}

/**
 * Provider implementation for stake protocol
 * Exports a singleton instance that can be used to fetch stake pool data
 */
const stakeProtocolProvider: Provider = {
    async get(
        runtime: IAgentRuntime
    ): Promise<StakeProtocolData | string | null> {
        const provider = new StakeProtocolProvider();
        try {
            return await provider.getStakePoolInfo(runtime);
        } catch (error) {
            elizaLogger.error("Error in stake protocol provider:", error);
            return "Sorry, I couldn't fetch the stake protocol data at the moment.";
        }
    },
};

export { stakeProtocolProvider };

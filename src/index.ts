export * from "./providers/token";
export * from "./providers/wallet";
export * from "./providers/trustScoreProvider";
export * from "./evaluators/trust";
import type { Plugin } from "@elizaos/core";
import transferToken from "./actions/transfer";
import transferSol from "./actions/transfer_sol";
import { TokenProvider } from "./providers/token";
import { WalletProvider } from "./providers/wallet";
import { getTokenBalance, getTokenBalances } from "./providers/tokenUtils";
import { walletProvider } from "./providers/wallet";
import { trustScoreProvider } from "./providers/trustScoreProvider";
import { trustEvaluator } from "./evaluators/trust";
import { executeSwap } from "./actions/swap";
import take_order from "./actions/takeOrder";
import pumpfun from "./actions/pumpfun";
import fomo from "./actions/fomo";
import { executeSwapForDAO } from "./actions/swapDao";
import liquidStake from "./actions/liquidStake.js";
export { TokenProvider, WalletProvider, getTokenBalance, getTokenBalances };
export const solanaPlugin: Plugin = {
    name: "solana",
    description: "Solana Plugin for Eliza",
    actions: [
        transferToken,
        transferSol,
        executeSwap,
        pumpfun,
        fomo,
        executeSwapForDAO,
        take_order,
        liquidStake,
    ],
    evaluators: [trustEvaluator],
    providers: [walletProvider, trustScoreProvider],
};
export default solanaPlugin;

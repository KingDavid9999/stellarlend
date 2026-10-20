/**
 * Asset metadata registry.
 *
 * Single source of truth for descriptive, non-financial metadata about the
 * assets StellarLend supports. Risk parameters (collateral factor, caps, etc.)
 * and live prices are deliberately NOT part of this registry: they change and
 * are owned by the contract / oracle layers.
 */

export type AssetCategory = 'native' | 'stablecoin' | 'crypto' | 'defi';

export interface AssetMetadata {
  /** Ticker used across the API (case-sensitive canonical form, e.g. "yXLM"). */
  symbol: string;
  /** Human-readable asset name. */
  name: string;
  category: AssetCategory;
  /** Number of decimal places in the asset's smallest unit (Stellar precision is 7). */
  decimals: number;
  /** True only for the network's native asset (XLM). */
  isNative: boolean;
}

/** Stellar assets, and the contract's normalised amounts, use 7 decimal places. */
const STELLAR_DECIMALS = 7;

const ASSETS: readonly AssetMetadata[] = Object.freeze(
  [
    { symbol: 'XLM', name: 'Stellar Lumens', category: 'native', isNative: true },
    { symbol: 'USDC', name: 'USD Coin', category: 'stablecoin', isNative: false },
    { symbol: 'BTC', name: 'Bitcoin', category: 'crypto', isNative: false },
    { symbol: 'ETH', name: 'Ethereum', category: 'crypto', isNative: false },
    { symbol: 'SOL', name: 'Solana', category: 'crypto', isNative: false },
    { symbol: 'AQUA', name: 'Aquarius', category: 'defi', isNative: false },
    { symbol: 'yXLM', name: 'Yield XLM', category: 'defi', isNative: false },
  ].map((asset) => Object.freeze({ ...asset, decimals: STELLAR_DECIMALS } as AssetMetadata))
);

const BY_SYMBOL: ReadonlyMap<string, AssetMetadata> = new Map(
  ASSETS.map((asset) => [asset.symbol.toUpperCase(), asset])
);

export class AssetMetadataService {
  /** All supported assets, in registry order. Returns copies; callers cannot mutate the registry. */
  listAssets(): AssetMetadata[] {
    return ASSETS.map((asset) => ({ ...asset }));
  }

  /** Look up one asset by symbol, case-insensitively. Returns undefined when unknown. */
  getAsset(symbol: string): AssetMetadata | undefined {
    const asset = BY_SYMBOL.get(symbol.trim().toUpperCase());
    return asset ? { ...asset } : undefined;
  }
}

export const assetMetadataService = new AssetMetadataService();

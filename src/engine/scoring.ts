/**
 * Momentum Scoring Functions
 *
 * Calculates momentum scores according to Phase 4 specification:
 * - Volume Score: 30 points max
 * - Holder Score: 25 points max
 * - Liquidity Score: 20 points max
 * - Social Score: 15 points max
 * - Safety Score: 10 points max
 * Total: 100 points
 */

import type {
  VolumeMetrics,
  HolderMetrics,
  LiquidityMetrics,
  SafetyMetrics,
} from '../analyzers/types.js';
import { lamportsToSol } from '../analyzers/base.js';
import type {
  VolumeScoreBreakdown,
  HolderScoreBreakdown,
  LiquidityScoreBreakdown,
  SocialScoreBreakdown,
  SafetyScoreBreakdown,
  ScoreBreakdown,
} from './types.js';

// =============================================================================
// VOLUME SCORING (30 points max)
// =============================================================================

/**
 * Calculates volume score (0-30 points)
 *
 * Sub-components:
 * - Volume velocity (0-15 pts): Is volume accelerating?
 * - Buy ratio (0-10 pts): More buying than selling?
 * - Volume spike (0-5 pts): Recent spike detected?
 */
export function calculateVolumeScore(
  metrics: VolumeMetrics | null
): VolumeScoreBreakdown {
  if (!metrics) {
    return { velocityPoints: 0, buyRatioPoints: 0, spikePoints: 0, total: 0 };
  }

  // Volume Velocity Points (0-15)
  let velocityPoints = 0;
  if (metrics.volumeVelocity > 2.0) {
    velocityPoints = 15; // 200%+ increase
  } else if (metrics.volumeVelocity > 1.0) {
    velocityPoints = 10; // 100%+ increase
  } else if (metrics.volumeVelocity > 0.5) {
    velocityPoints = 5; // 50%+ increase
  } else if (metrics.volumeVelocity < 0) {
    velocityPoints = 0; // Decreasing
  }

  // Buy Ratio Points (0-10)
  let buyRatioPoints = 0;
  if (metrics.buyRatio > 0.7) {
    buyRatioPoints = 10; // 70%+ buys
  } else if (metrics.buyRatio > 0.6) {
    buyRatioPoints = 7; // 60%+ buys
  } else if (metrics.buyRatio > 0.5) {
    buyRatioPoints = 3; // Balanced
  } else {
    buyRatioPoints = 0; // More sells
  }

  // Volume Spike Points (0-5)
  let spikePoints = 0;
  if (metrics.hasVolumeSpike) {
    spikePoints = 5;
  }

  // Penalty for wash trading (reduces total)
  let total = velocityPoints + buyRatioPoints + spikePoints;
  if (metrics.washTradingScore > 0.5) {
    total = Math.max(0, total - 10); // Heavy penalty
  } else if (metrics.washTradingScore > 0.3) {
    total = Math.max(0, total - 5); // Moderate penalty
  }

  return {
    velocityPoints,
    buyRatioPoints,
    spikePoints,
    total: Math.min(30, Math.max(0, total)),
  };
}

// =============================================================================
// HOLDER SCORING (25 points max)
// =============================================================================

/**
 * Calculates holder score (0-25 points)
 *
 * Sub-components:
 * - Holder velocity (0-10 pts): Growing fast?
 * - Concentration safety (0-10 pts): Well distributed?
 * - Unique holder count (0-5 pts): Critical mass?
 */
export function calculateHolderScore(
  metrics: HolderMetrics | null
): HolderScoreBreakdown {
  if (!metrics) {
    return { velocityPoints: 0, concentrationPoints: 0, countPoints: 0, total: 0 };
  }

  // Holder Velocity Points (0-10)
  let velocityPoints = 0;
  if (metrics.holderVelocity > 10) {
    velocityPoints = 10; // >10 holders/min
  } else if (metrics.holderVelocity > 5) {
    velocityPoints = 7; // >5 holders/min
  } else if (metrics.holderVelocity > 2) {
    velocityPoints = 3; // >2 holders/min
  } else if (metrics.holderVelocity < 0) {
    velocityPoints = 0; // Losing holders
  }

  // Concentration Points (0-10) - Lower concentration = higher score
  let concentrationPoints = 0;
  if (metrics.top10Concentration < 20) {
    concentrationPoints = 10; // Well distributed
  } else if (metrics.top10Concentration < 30) {
    concentrationPoints = 7;
  } else if (metrics.top10Concentration < 40) {
    concentrationPoints = 3;
  } else {
    concentrationPoints = 0; // Too concentrated
  }

  // Holder Count Points (0-5)
  let countPoints = 0;
  if (metrics.totalHolders > 500) {
    countPoints = 5;
  } else if (metrics.totalHolders > 200) {
    countPoints = 3;
  } else if (metrics.totalHolders > 50) {
    countPoints = 1;
  }

  // Penalty for clustering (sybil attacks)
  let total = velocityPoints + concentrationPoints + countPoints;
  if (metrics.clusterPercentage > 30) {
    total = Math.max(0, total - 7); // Heavy penalty for sybil
  } else if (metrics.clusterPercentage > 15) {
    total = Math.max(0, total - 3);
  }

  return {
    velocityPoints,
    concentrationPoints,
    countPoints,
    total: Math.min(25, Math.max(0, total)),
  };
}

// =============================================================================
// LIQUIDITY SCORING (20 points max)
// =============================================================================

/**
 * Calculates liquidity score (0-20 points)
 *
 * Sub-components:
 * - Bonding progress (0-15 pts): In the entry zone?
 * - Liquidity depth (0-5 pts): Enough liquidity?
 */
export function calculateLiquidityScore(
  metrics: LiquidityMetrics | null
): LiquidityScoreBreakdown {
  if (!metrics) {
    return { progressPoints: 0, depthPoints: 0, total: 0 };
  }

  // Bonding Progress Points (0-15) - CRITICAL
  let progressPoints = 0;
  const progress = metrics.bondingCurveProgress;

  if (progress >= 80 && progress <= 90) {
    progressPoints = 15; // SWEET SPOT
  } else if ((progress >= 70 && progress < 80) || (progress > 90 && progress <= 95)) {
    progressPoints = 10; // ACCEPTABLE
  } else if ((progress >= 60 && progress < 70) || (progress > 95 && progress < 100)) {
    progressPoints = 5; // RISKY
  } else {
    progressPoints = 0; // NO TRADE (< 60% or migrated)
  }

  // Liquidity Depth Points (0-5)
  let depthPoints = 0;
  const liquiditySol = lamportsToSol(metrics.totalLiquiditySol);

  if (liquiditySol > 50) {
    depthPoints = 5; // $50k+ liquidity (assuming ~$100 SOL)
  } else if (liquiditySol > 20) {
    depthPoints = 3;
  } else if (liquiditySol > 10) {
    depthPoints = 1;
  }

  // Penalty for high slippage
  let total = progressPoints + depthPoints;
  if (metrics.slippage1Sol > 10) {
    total = Math.max(0, total - 5);
  } else if (metrics.slippage1Sol > 5) {
    total = Math.max(0, total - 2);
  }

  return {
    progressPoints,
    depthPoints,
    total: Math.min(20, Math.max(0, total)),
  };
}

// =============================================================================
// SOCIAL SCORING (15 points max)
// =============================================================================

/**
 * Calculates social score (0-15 points)
 *
 * Sub-components:
 * - Social links present (0-10 pts)
 * - Community growth indicators (0-5 pts)
 */
export function calculateSocialScore(
  safetyMetrics: SafetyMetrics | null
): SocialScoreBreakdown {
  if (!safetyMetrics?.socialVerification) {
    return { linksPoints: 0, growthPoints: 0, total: 0 };
  }

  const social = safetyMetrics.socialVerification;

  // Social Links Points (0-10)
  let linksPoints = 0;
  const linkCount = [
    social.hasWebsite,
    social.hasTwitter,
    social.hasTelegram,
  ].filter(Boolean).length;

  if (linkCount === 3) {
    linksPoints = 10;
  } else if (linkCount === 2) {
    linksPoints = 7;
  } else if (linkCount === 1) {
    linksPoints = 3;
  }

  // Community Growth Points (0-5)
  // Note: In production, would check actual community metrics
  let growthPoints = 0;
  // Using social verification score as proxy
  if (social.score >= 8) {
    growthPoints = 5;
  } else if (social.score >= 5) {
    growthPoints = 3;
  }

  return {
    linksPoints,
    growthPoints,
    total: Math.min(15, linksPoints + growthPoints),
  };
}

// =============================================================================
// SAFETY SCORING (10 points max)
// =============================================================================

/**
 * Calculates safety score (0-10 points)
 *
 * Normalizes the safety analyzer score to 0-10 range
 */
export function calculateSafetyScore(
  metrics: SafetyMetrics | null
): SafetyScoreBreakdown {
  if (!metrics) {
    return { total: 0 };
  }

  // Safety analyzer returns 0-100, normalize to 0-10
  const normalized = (metrics.safetyScore / 100) * 10;

  return {
    total: Math.min(10, Math.max(0, normalized)),
  };
}

// =============================================================================
// TOTAL SCORE CALCULATION
// =============================================================================

/**
 * Calculates complete score breakdown
 */
export function calculateTotalScore(
  volume: VolumeMetrics | null,
  holders: HolderMetrics | null,
  liquidity: LiquidityMetrics | null,
  safety: SafetyMetrics | null
): ScoreBreakdown {
  const volumeScore = calculateVolumeScore(volume);
  const holderScore = calculateHolderScore(holders);
  const liquidityScore = calculateLiquidityScore(liquidity);
  const socialScore = calculateSocialScore(safety);
  const safetyScore = calculateSafetyScore(safety);

  const totalScore =
    volumeScore.total +
    holderScore.total +
    liquidityScore.total +
    socialScore.total +
    safetyScore.total;

  return {
    volume: volumeScore,
    holders: holderScore,
    liquidity: liquidityScore,
    social: socialScore,
    safety: safetyScore,
    totalScore: Math.min(100, Math.max(0, totalScore)),
  };
}

// =============================================================================
// SCORE ANALYSIS HELPERS
// =============================================================================

/**
 * Gets the weakest scoring area
 */
export function getWeakestArea(
  breakdown: ScoreBreakdown
): 'volume' | 'holders' | 'liquidity' | 'social' | 'safety' {
  const scores = [
    { area: 'volume' as const, score: breakdown.volume.total, max: 30 },
    { area: 'holders' as const, score: breakdown.holders.total, max: 25 },
    { area: 'liquidity' as const, score: breakdown.liquidity.total, max: 20 },
    { area: 'social' as const, score: breakdown.social.total, max: 15 },
    { area: 'safety' as const, score: breakdown.safety.total, max: 10 },
  ];

  // Calculate percentage of max for each
  const withPercent = scores.map(s => ({
    ...s,
    percent: (s.score / s.max) * 100,
  }));

  // Return the one with lowest percentage
  return withPercent.sort((a, b) => a.percent - b.percent)[0]?.area ?? 'safety';
}

/**
 * Gets score improvement suggestions
 */
export function getImprovementSuggestions(
  breakdown: ScoreBreakdown
): string[] {
  const suggestions: string[] = [];

  // Volume suggestions
  if (breakdown.volume.velocityPoints < 10) {
    suggestions.push('Volume velocity is low - wait for momentum');
  }
  if (breakdown.volume.buyRatioPoints < 7) {
    suggestions.push('Buy ratio weak - more sellers than buyers');
  }

  // Holder suggestions
  if (breakdown.holders.concentrationPoints < 7) {
    suggestions.push('High holder concentration - whale risk');
  }
  if (breakdown.holders.countPoints < 3) {
    suggestions.push('Low holder count - insufficient adoption');
  }

  // Liquidity suggestions
  if (breakdown.liquidity.progressPoints < 10) {
    suggestions.push('Not in optimal bonding curve zone (80-90%)');
  }
  if (breakdown.liquidity.depthPoints < 3) {
    suggestions.push('Low liquidity depth - high slippage risk');
  }

  // Social suggestions
  if (breakdown.social.linksPoints < 7) {
    suggestions.push('Missing social links - verify legitimacy');
  }

  // Safety suggestions
  if (breakdown.safety.total < 7) {
    suggestions.push('Safety score too low - high rug risk');
  }

  return suggestions;
}

/**
 * Formats score breakdown for logging
 */
export function formatScoreBreakdown(breakdown: ScoreBreakdown): string {
  return [
    `Volume: ${breakdown.volume.total}/30`,
    `(vel:${breakdown.volume.velocityPoints} buy:${breakdown.volume.buyRatioPoints} spike:${breakdown.volume.spikePoints})`,
    `| Holders: ${breakdown.holders.total}/25`,
    `(vel:${breakdown.holders.velocityPoints} conc:${breakdown.holders.concentrationPoints} cnt:${breakdown.holders.countPoints})`,
    `| Liquidity: ${breakdown.liquidity.total}/20`,
    `(prog:${breakdown.liquidity.progressPoints} depth:${breakdown.liquidity.depthPoints})`,
    `| Social: ${breakdown.social.total}/15`,
    `| Safety: ${breakdown.safety.total.toFixed(1)}/10`,
    `| TOTAL: ${breakdown.totalScore}/100`,
  ].join(' ');
}

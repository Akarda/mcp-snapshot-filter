export interface FilterConfig {
  filterLevel: "off" | "light" | "moderate" | "aggressive";
  maxNodes: number;
  maxDepth: number;
  maxSimilarSiblings: number;
  stripDecorative: boolean;
  navigationCollapseMode: "off" | "peripheral" | "all";
  focusMainContent: boolean;
  evaluateFilter: {
    maxJsonArrayItems: number;
    maxTextLength: number;
  };
  collapseSingleChildWrappers: boolean;
  stripAttributes: boolean;
  networkFilter: {
    stripResourceTypes: string[];
    maxRequests: number;
  };
  consoleFilter: {
    stripTypes: string[];
    maxMessages: number;
  };
}

const LIGHT: FilterConfig = {
  filterLevel: "light",
  maxNodes: 1000,
  maxDepth: 20,
  maxSimilarSiblings: 5,
  stripDecorative: true,
  navigationCollapseMode: "off",
  focusMainContent: false,
  collapseSingleChildWrappers: false,
  stripAttributes: false,
  networkFilter: {
    stripResourceTypes: ["image", "font"],
    maxRequests: 200,
  },
  consoleFilter: {
    stripTypes: ["debug", "verbose"],
    maxMessages: 100,
  },
  evaluateFilter: {
    maxJsonArrayItems: 100,
    maxTextLength: 100_000,
  },
};

const MODERATE: FilterConfig = {
  filterLevel: "moderate",
  maxNodes: 500,
  maxDepth: 15,
  maxSimilarSiblings: 3,
  stripDecorative: true,
  navigationCollapseMode: "peripheral",
  focusMainContent: false,
  collapseSingleChildWrappers: true,
  stripAttributes: true,
  networkFilter: {
    stripResourceTypes: ["image", "font", "stylesheet"],
    maxRequests: 100,
  },
  consoleFilter: {
    stripTypes: ["debug", "verbose", "dir", "dirxml"],
    maxMessages: 50,
  },
  evaluateFilter: {
    maxJsonArrayItems: 30,
    maxTextLength: 50_000,
  },
};

const AGGRESSIVE: FilterConfig = {
  filterLevel: "aggressive",
  maxNodes: 300,
  maxDepth: 10,
  maxSimilarSiblings: 2,
  stripDecorative: true,
  navigationCollapseMode: "all",
  focusMainContent: true,
  collapseSingleChildWrappers: true,
  stripAttributes: true,
  networkFilter: {
    stripResourceTypes: ["image", "font", "stylesheet", "media"],
    maxRequests: 50,
  },
  consoleFilter: {
    stripTypes: ["debug", "verbose", "dir", "dirxml", "trace"],
    maxMessages: 30,
  },
  evaluateFilter: {
    maxJsonArrayItems: 10,
    maxTextLength: 20_000,
  },
};

const OFF: FilterConfig = {
  filterLevel: "off",
  maxNodes: Infinity,
  maxDepth: Infinity,
  maxSimilarSiblings: Infinity,
  stripDecorative: false,
  navigationCollapseMode: "off",
  focusMainContent: false,
  collapseSingleChildWrappers: false,
  stripAttributes: false,
  networkFilter: {
    stripResourceTypes: [],
    maxRequests: Infinity,
  },
  consoleFilter: {
    stripTypes: [],
    maxMessages: Infinity,
  },
  evaluateFilter: {
    maxJsonArrayItems: Infinity,
    maxTextLength: Infinity,
  },
};

export const PRESETS: Record<FilterConfig["filterLevel"], FilterConfig> = {
  off: OFF,
  light: LIGHT,
  moderate: MODERATE,
  aggressive: AGGRESSIVE,
};

export function getConfig(level: string): FilterConfig {
  if (level in PRESETS) {
    return PRESETS[level as FilterConfig["filterLevel"]];
  }
  return PRESETS.moderate;
}

import { describe, expect, it } from "vitest";

import {
  formatOracleRef,
  normalizeTeamName,
  parseOracleRef,
  parseSelection,
  teamMatches,
  verificationForClaim,
} from "@/integrations/oracle/results";

describe("parseOracleRef", () => {
  it("accepts the canonical form", () => {
    expect(parseOracleRef("espn:eng.1:401879254")).toEqual({
      provider: "espn",
      league: "eng.1",
      eventId: "401879254",
    });
  });

  it("rejects a league the oracle cannot verify", () => {
    expect(parseOracleRef("espn:esp.1:401879254")).toBeNull();
  });

  it("rejects a non-numeric fixture id", () => {
    expect(parseOracleRef("espn:eng.1:abc")).toBeNull();
  });

  it("rejects extra segments and empty input", () => {
    expect(parseOracleRef("espn:eng.1:401879254:extra")).toBeNull();
    expect(parseOracleRef("")).toBeNull();
    expect(parseOracleRef("401879254")).toBeNull();
  });

  it("round-trips through the formatter", () => {
    const ref = parseOracleRef("espn:eng.1:401879254");
    expect(ref).not.toBeNull();
    if (ref === null) return;
    expect(formatOracleRef(ref)).toBe("espn:eng.1:401879254");
  });
});

describe("parseSelection", () => {
  it("reads a team-to-win selection", () => {
    expect(parseSelection("Arsenal to win")).toEqual({ subject: "arsenal", kind: "home" });
  });

  it("tolerates a leading article and trailing punctuation", () => {
    expect(parseSelection("The Magpies to win.")).toEqual({
      subject: "magpies",
      kind: "home",
    });
  });

  it("reads the draw", () => {
    expect(parseSelection("Draw")).toEqual({ subject: "draw", kind: "draw" });
  });

  it("returns null for markets it cannot interpret", () => {
    expect(parseSelection("Over 2.5 goals")).toBeNull();
    expect(parseSelection("Arsenal -1 handicap")).toBeNull();
    expect(parseSelection("to win")).toBeNull();
  });
});

describe("normalizeTeamName", () => {
  it("strips generic club suffixes so short and long forms agree", () => {
    expect(normalizeTeamName("Arsenal FC")).toBe("arsenal");
    expect(normalizeTeamName("Brighton & Hove Albion")).toBe("brighton and hove albion");
  });

  it("keeps the words that distinguish two clubs", () => {
    expect(normalizeTeamName("Manchester United")).toBe("manchester united");
    expect(normalizeTeamName("Manchester City")).toBe("manchester city");
    expect(normalizeTeamName("Newcastle United")).toBe("newcastle united");
  });

  it("expands the common abbreviations instead of deleting them", () => {
    expect(normalizeTeamName("Man Utd")).toBe("manchester united");
    expect(normalizeTeamName("Man City")).toBe("manchester city");
  });
});

describe("teamMatches", () => {
  it("matches a short name against the provider's full name", () => {
    expect(teamMatches("arsenal", "Arsenal")).toBe(true);
    expect(teamMatches("newcastle", "Newcastle United")).toBe(true);
  });

  it("matches when the picker wrote the longer form", () => {
    expect(teamMatches("manchester city", "Man City")).toBe(true);
    expect(teamMatches("Man Utd", "Manchester United")).toBe(true);
  });

  it("does not confuse the two Manchester clubs", () => {
    expect(teamMatches("Man Utd", "Manchester City")).toBe(false);
    expect(teamMatches("Man City", "Manchester United")).toBe(false);
  });

  it("flags a one-word name that fits both sides as ambiguous", () => {
    expect(teamMatches("United", "Manchester United")).toBe(true);
    expect(teamMatches("United", "Newcastle United")).toBe(true);
  });

  it("refuses names that share no significant token", () => {
    expect(teamMatches("arsenal", "Chelsea")).toBe(false);
    expect(teamMatches("manchester united", "manchester city")).toBe(false);
  });

  it("refuses empty names instead of matching everything", () => {
    expect(teamMatches("", "Arsenal")).toBe(false);
    expect(teamMatches("Arsenal", "FC")).toBe(false);
  });
});

describe("verificationForClaim", () => {
  it("confirms an honest claim", () => {
    expect(verificationForClaim("win", "win")).toBe("oracle_verified");
    expect(verificationForClaim("loss", "loss")).toBe("oracle_verified");
  });

  it("contradicts a claim the provider disagrees with", () => {
    expect(verificationForClaim("win", "loss")).toBe("oracle_contradicted");
    expect(verificationForClaim("loss", "win")).toBe("oracle_contradicted");
  });

  it("does not grant a void claim a free pass on a completed fixture", () => {
    expect(verificationForClaim("void", "win")).toBe("oracle_contradicted");
    expect(verificationForClaim("void", "loss")).toBe("oracle_contradicted");
  });
});

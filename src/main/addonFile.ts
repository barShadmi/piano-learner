// The sound engine file is named audio-engine.<platform>-<cpu>[-<abi>].node,
// for example audio-engine.win32-x64-msvc.node. Pick the one for this computer.
export function pickAddonFile(
  files: readonly string[],
  platform: string,
  arch: string
): string | undefined {
  const prefix = `audio-engine.${platform}-${arch}`
  return [...files]
    .sort()
    .find((name) => name.endsWith('.node') && (name === `${prefix}.node` || name.startsWith(`${prefix}-`)))
}

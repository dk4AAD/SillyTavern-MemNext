const mockUrl = new URL('./mocks/sillytavern.js', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.includes('script.js') ||
    specifier.includes('extensions.js') ||
    specifier.includes('engine.js') ||
    specifier.includes('instruct-mode.js') ||
    specifier.includes('itemized-prompts.js') ||
    specifier.includes('group-chats.js') ||
    specifier.includes('power-user.js') ||
    specifier.includes('RossAscends-mods.js') ||
    specifier.includes('i18n.js') ||
    specifier.startsWith('../../../utils.js') ||
    specifier.startsWith('../../../constants.js') ||
    specifier.startsWith('../../../macros.js')
  ) {
    return {
      url: mockUrl,
      shortCircuit: true
    };
  }
  return nextResolve(specifier, context);
}

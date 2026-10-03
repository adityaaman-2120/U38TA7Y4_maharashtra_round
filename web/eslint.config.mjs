import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "src/lib/contracts.ts", "src/vendor/**"] },
  {
    // Every piece of text a person reads comes from the message catalogues (src/messages), never from the JSX itself.
    files: ["src/**/*.tsx"],
    rules: {
      "react/jsx-no-literals": ["error", { noStrings: true, allowedStrings: ["Heirloom", "·", "…", "→", "×", "|", "#", "/", "(", ")", ":", ",", ".", "-", "—", "+", "✓"], ignoreProps: true }],
    },
  },
];

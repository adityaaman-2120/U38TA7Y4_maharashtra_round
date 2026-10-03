import type messages from "../messages/en";

// Message keys are type-checked against the English messages: a typo in a key is a compile error.
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof messages;
  }
}

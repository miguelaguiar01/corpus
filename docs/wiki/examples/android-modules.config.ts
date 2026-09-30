import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-mail",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt-BR"],
  sources: [
    // The modules' res directories, which Gradle merges into one set of
    // resources: lower-priority modules first, so the later one wins.
    {
      adapter: "android",
      type: "ui",
      path: [
        "core/ui/src/main/res",
        "feature/settings/src/main/res",
        "app/src/main/res",
      ],
      merge: "last-wins",
    },
    // Compose Multiplatform's own resources, one Res class per module:
    // their ids are `<module>:<name>`.
    {
      adapter: "android",
      type: "ui",
      path: "feature/{ns}/src/commonMain/composeResources",
    },
  ],
});

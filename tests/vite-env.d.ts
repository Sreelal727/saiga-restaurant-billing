// Minimal ambient declaration for the `import.meta.glob` helper that
// vitest's bundler resolves. Scoped to the test directory so production
// code stays untouched.
interface ImportMeta {
  readonly glob: (
    patterns: string | readonly string[],
    options?: Record<string, unknown>
  ) => Record<string, () => Promise<unknown>>;
}

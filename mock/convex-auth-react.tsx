// Screenshot harness only: stands in for @convex-dev/auth/react.
export function ConvexAuthProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; }
export function useAuthActions() {
  return { signIn: async () => {}, signOut: async () => {} };
}

// Screenshot harness only: stands in for @convex-dev/auth/react. Sign-up and reset pretend a code went out.
export function ConvexAuthProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; }
export function useAuthActions() {
  return {
    signIn: async (_p: string, params?: FormData | Record<string, unknown>) => {
      const flow = params instanceof FormData ? params.get("flow") : params?.flow;
      return { signingIn: flow === "signIn", redirect: undefined };
    },
    signOut: async () => {},
  };
}

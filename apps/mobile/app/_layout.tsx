import "react-native-reanimated";
import { QueryClientProvider } from "@tanstack/react-query";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/query-client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { IntroScreen } from "@/components/alchemy/intro-screen";

export default function RootLayout(): React.JSX.Element {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <RootNavigator />
      </QueryClientProvider>
    </AuthProvider>
  );
}

function RootNavigator(): React.JSX.Element {
  const { initialized, isAuthenticated, authError } = useAuth();
  const onboardingStateQuery = useQuery({
    queryKey: ["onboarding", "state"],
    queryFn: () => api.getOnboardingState(),
    enabled: initialized && isAuthenticated && !authError
  });

  if (!initialized) {
    return <IntroScreen subtitle="Loading secure session..." />;
  }

  if (authError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Auth configuration error</Text>
        <Text style={styles.subtle}>{authError}</Text>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="sign-in" options={{ headerShown: false, animation: "fade_from_bottom" }} />
        <Stack.Screen name="register" options={{ headerShown: false, animation: "fade_from_bottom" }} />
      </Stack>
    );
  }

  if (onboardingStateQuery.isPending) {
    return <IntroScreen subtitle="Calibrating your assistant..." />;
  }

  if (onboardingStateQuery.isError) {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="onboarding" options={{ headerShown: false, animation: "slide_from_right" }} />
      </Stack>
    );
  }

  const needsOnboarding = onboardingStateQuery.data ? !onboardingStateQuery.data.completed : true;

  if (needsOnboarding) {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="onboarding" options={{ headerShown: false, animation: "slide_from_right" }} />
      </Stack>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: "fade" }} />
      <Stack.Screen name="recipe/[id]" options={{ headerShown: false, animation: "slide_from_right" }} />
      <Stack.Screen name="preferences" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="settings" options={{ presentation: "modal", headerShown: false }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    backgroundColor: "#F8FAFC",
    gap: 8
  },
  subtle: {
    color: "#475569",
    textAlign: "center"
  },
  errorTitle: {
    color: "#B91C1C",
    fontSize: 16,
    fontWeight: "700"
  }
});

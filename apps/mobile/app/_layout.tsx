import "react-native-reanimated";
import { QueryClientProvider } from "@tanstack/react-query";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/query-client";

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
  const { initialized, session, authError } = useAuth();

  if (!initialized) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.subtle}>Loading session…</Text>
      </View>
    );
  }

  if (authError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Auth configuration error</Text>
        <Text style={styles.subtle}>{authError}</Text>
      </View>
    );
  }

  if (!session) {
    return (
      <Stack>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack>
    );
  }

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="preferences" options={{ presentation: "modal", title: "Preferences" }} />
      <Stack.Screen name="settings" options={{ presentation: "modal", title: "Settings" }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
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

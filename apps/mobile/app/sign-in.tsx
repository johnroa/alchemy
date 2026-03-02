import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";

type AuthMode = "sign-in" | "sign-up";

export default function SignInScreen(): React.JSX.Element {
  const { isAuthenticated, signInWithPassword, signUpWithPassword } = useAuth();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (isAuthenticated) {
    return <Redirect href="/(tabs)/my-cookbook" />;
  }

  const submit = async (): Promise<void> => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setErrorMessage("Email and password are required.");
      return;
    }

    setBusy(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const error =
      mode === "sign-in"
        ? await signInWithPassword(trimmedEmail, password)
        : await signUpWithPassword(trimmedEmail, password);

    setBusy(false);

    if (error) {
      setErrorMessage(error);
      return;
    }

    if (mode === "sign-up") {
      setSuccessMessage("Account created. Check your email if confirmation is required, then sign in.");
      setMode("sign-in");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome to Alchemy</Text>
        <Text style={styles.subtitle}>Sign in to sync your cookbook, preferences, and recipe drafts.</Text>

        <View style={styles.fieldWrap}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="chef@cookwithalchemy.com"
            style={styles.input}
          />
        </View>

        <View style={styles.fieldWrap}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            style={styles.input}
          />
        </View>

        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}

        <Pressable style={styles.primaryButton} onPress={() => void submit()} disabled={busy}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>{mode === "sign-in" ? "Sign In" : "Create Account"}</Text>}
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => {
            setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"));
            setErrorMessage(null);
            setSuccessMessage(null);
          }}
          disabled={busy}
        >
          <Text style={styles.secondaryButtonText}>
            {mode === "sign-in" ? "Need an account? Create one" : "Already have an account? Sign in"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    padding: 20
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
    padding: 20,
    gap: 12
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#0F172A"
  },
  subtitle: {
    color: "#475569",
    marginBottom: 4
  },
  fieldWrap: {
    gap: 6
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A"
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: "#FFFFFF"
  },
  errorText: {
    color: "#B91C1C",
    fontSize: 13
  },
  successText: {
    color: "#047857",
    fontSize: 13
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: "#047857",
    alignItems: "center",
    justifyContent: "center"
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700"
  },
  secondaryButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryButtonText: {
    color: "#334155",
    fontWeight: "600"
  }
});

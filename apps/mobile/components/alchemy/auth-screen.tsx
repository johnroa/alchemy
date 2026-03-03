import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { BlurView } from "expo-blur";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { AlchemyButton, AlchemyField, AlchemyHeroBackground, AlchemyScreen } from "@/components/alchemy/primitives";
import { alchemyColors, alchemySpacing, alchemyTypography } from "@/components/alchemy/theme";
import { useAuth } from "@/lib/auth";

type AuthMode = "sign-in" | "register";

export function AuthScreen(props: { mode: AuthMode }): React.JSX.Element {
  const { signInWithPassword, signUpWithPassword } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const title = useMemo(() => (props.mode === "sign-in" ? "Sign in" : "Register"), [props.mode]);

  const submit = async (): Promise<void> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setErrorMessage("Email and password are required.");
      return;
    }

    if (props.mode === "register" && repeatPassword !== password) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setErrorMessage(null);
    setBusy(true);

    const error =
      props.mode === "sign-in"
        ? await signInWithPassword(normalizedEmail, password)
        : await signUpWithPassword(normalizedEmail, password);

    setBusy(false);

    if (error) {
      setErrorMessage(error);
      return;
    }

    if (props.mode === "register") {
      router.replace("/sign-in");
    }
  };

  return (
    <AlchemyScreen>
      <AlchemyHeroBackground />
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", android: undefined })}
        style={styles.container}
        keyboardVerticalOffset={40}
      >
        <Animated.View entering={FadeInDown.duration(350)} style={styles.contentWrap}>
          <Text style={styles.brand}>alchemy</Text>

          <BlurView intensity={24} tint="dark" style={styles.formCard}>
            <View style={styles.formWrap}>
              <AlchemyField
                label="E-mail"
                value={email}
                onChangeText={setEmail}
                placeholder="chef@cookwithalchemy.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <AlchemyField
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                secureTextEntry
              />
              {props.mode === "register" ? (
                <AlchemyField
                  label="Repeat Password"
                  value={repeatPassword}
                  onChangeText={setRepeatPassword}
                  placeholder="••••••••"
                  secureTextEntry
                />
              ) : null}

              {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

              <AlchemyButton label={title} onPress={() => void submit()} loading={busy} />
            </View>
          </BlurView>

          {props.mode === "sign-in" ? (
            <Animated.View entering={FadeInUp.delay(120).duration(350)} style={styles.footerWrap}>
              <Text style={styles.subtle}>Don’t have an account?</Text>
              <Pressable style={styles.linkButton} onPress={() => router.push("/register" as never)}>
                <Text style={styles.linkText}>Register</Text>
              </Pressable>
            </Animated.View>
          ) : (
            <Animated.View entering={FadeInUp.delay(120).duration(350)} style={styles.footerWrap}>
              <Text style={styles.subtle}>Already have an account?</Text>
              <Pressable style={styles.linkButton} onPress={() => router.push("/sign-in" as never)}>
                <Text style={styles.linkText}>Sign in</Text>
              </Pressable>
            </Animated.View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </AlchemyScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center"
  },
  contentWrap: {
    paddingHorizontal: 32,
    gap: 20
  },
  brand: {
    color: alchemyColors.white,
    fontSize: 54,
    fontWeight: "600",
    alignSelf: "center",
    marginBottom: 16
  },
  formWrap: {
    gap: alchemySpacing.sm
  },
  formCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    overflow: "hidden",
    padding: 14
  },
  error: {
    color: alchemyColors.danger,
    ...alchemyTypography.caption
  },
  footerWrap: {
    marginTop: 22,
    alignItems: "center",
    gap: 12
  },
  subtle: {
    color: alchemyColors.grey1,
    ...alchemyTypography.body
  },
  linkButton: {
    width: "100%",
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: alchemyColors.grey4,
    alignItems: "center",
    justifyContent: "center"
  },
  linkText: {
    color: alchemyColors.dark,
    ...alchemyTypography.bodyBold
  }
});

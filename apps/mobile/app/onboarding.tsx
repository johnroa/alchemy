import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeInDown } from "react-native-reanimated";
import { AlchemyHeroBackground, AlchemyScreen } from "@/components/alchemy/primitives";
import { alchemyColors, alchemyRadius, alchemyTypography } from "@/components/alchemy/theme";
import { api, type OnboardingChatMessage, type OnboardingState } from "@/lib/api";

type ChatMessage = OnboardingChatMessage & {
  id: string;
};

const initialOnboardingState: OnboardingState = {
  completed: false,
  progress: 0,
  missing_topics: ["skill", "equipment", "dietary_preferences", "presentation_preferences"],
  state: {}
};

export default function OnboardingScreen(): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const initialized = useRef(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [onboardingState, setOnboardingState] = useState<OnboardingState>(initialOnboardingState);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const transcript = useMemo<OnboardingChatMessage[]>(() => {
    return messages.map((message) => ({ role: message.role, content: message.content }));
  }, [messages]);

  const onboardingMutation = useMutation({
    mutationFn: (payload: { message: string; transcript: OnboardingChatMessage[]; state: Record<string, unknown> }) =>
      api.sendOnboardingMessage(payload),
    onSuccess: async (response, variables) => {
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: response.assistant_reply.text
      };

      setMessages((current) => {
        if (!variables.message) {
          return [assistantMessage];
        }

        return [...current, assistantMessage];
      });
      setOnboardingState(response.onboarding_state);
      setFatalError(null);

      if (response.onboarding_state.completed) {
        queryClient.setQueryData(["onboarding", "state"], response.onboarding_state);
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace("/(tabs)/my-cookbook");
        return;
      }

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onError: (error) => {
      setFatalError(error instanceof Error ? error.message : "Could not load onboarding interview");
    }
  });

  useEffect(() => {
    if (initialized.current) {
      return;
    }

    initialized.current = true;
    onboardingMutation.mutate({
      message: "",
      transcript: [],
      state: { stage: "start" }
    });
  }, [onboardingMutation]);

  const submitMessage = (messageOverride?: string): void => {
    const value = (messageOverride ?? input).trim();
    if (!value) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: value
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setFatalError(null);

    const nextTranscript = [...transcript, { role: "user" as const, content: value }];

    onboardingMutation.mutate({
      message: value,
      transcript: nextTranscript,
      state: onboardingState.state
    });
  };

  const progressPct = Math.round(Math.max(0, Math.min(1, onboardingState.progress || 0)) * 100);

  return (
    <AlchemyScreen>
      <AlchemyHeroBackground />
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", android: undefined })}
        keyboardVerticalOffset={84}
        style={styles.container}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Set Up Your Alchemy</Text>
          <Text style={styles.subtitle}>Adaptive interview for preferences and kitchen context.</Text>
          <View style={styles.progressBarWrap}>
            <View style={[styles.progressBarFill, { width: `${Math.max(progressPct, 8)}%` }]} />
          </View>
          <Text style={styles.progressText}>{progressPct}% complete</Text>
        </View>

        {fatalError && messages.length === 0 ? (
          <View style={styles.stateCard}>
            <Text style={styles.stateTitleError}>Interview unavailable</Text>
            <Text style={styles.stateText}>{fatalError}</Text>
            <Pressable
              style={styles.retryButton}
              onPress={() =>
                onboardingMutation.mutate({
                  message: "",
                  transcript: [],
                  state: { stage: "start" }
                })
              }
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.chatContent}
            renderItem={({ item }) => (
              <Animated.View entering={FadeInDown.duration(180)} style={[styles.bubbleWrap, item.role === "assistant" ? styles.left : styles.right]}>
                <BlurView
                  intensity={item.role === "assistant" ? 18 : 24}
                  tint="dark"
                  style={[styles.bubble, item.role === "assistant" ? styles.assistantBubble : styles.userBubble]}
                >
                  <Text style={styles.bubbleText}>{item.content}</Text>
                </BlurView>
              </Animated.View>
            )}
            ListEmptyComponent={
              <View style={styles.stateCard}>
                <ActivityIndicator color={alchemyColors.grey4} />
                <Text style={styles.stateText}>Starting your onboarding interview...</Text>
              </View>
            }
            ListFooterComponent={
              fatalError ? (
                <View style={styles.inlineErrorWrap}>
                  <Text style={styles.inlineErrorText}>{fatalError}</Text>
                </View>
              ) : null
            }
          />
        )}

        <View style={styles.composerWrap}>
          <BlurView intensity={28} tint="dark" style={styles.composerInner}>
            <TextInput
              style={styles.input}
              placeholder="Share a preference, or ask to skip setup"
              placeholderTextColor={alchemyColors.grey1}
              value={input}
              onChangeText={setInput}
              multiline
            />
            <Pressable
              style={[styles.sendButton, onboardingMutation.isPending ? styles.sendButtonDisabled : undefined]}
              onPress={() => submitMessage()}
              disabled={onboardingMutation.isPending}
            >
              <Text style={styles.sendButtonText}>{onboardingMutation.isPending ? "..." : "➤"}</Text>
            </Pressable>
          </BlurView>
          <Pressable
            style={styles.skipLink}
            onPress={() => submitMessage("I want to skip onboarding for now and start using the app.")}
            disabled={onboardingMutation.isPending}
          >
            <Text style={styles.skipLinkText}>Skip for now</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </AlchemyScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  header: {
    paddingTop: 64,
    paddingHorizontal: 16,
    paddingBottom: 8
  },
  title: {
    color: alchemyColors.white,
    ...alchemyTypography.titleXL
  },
  subtitle: {
    color: alchemyColors.grey2,
    ...alchemyTypography.body,
    marginTop: 4
  },
  progressBarWrap: {
    marginTop: 12,
    height: 7,
    borderRadius: alchemyRadius.pill,
    backgroundColor: "rgba(98,110,123,0.35)",
    overflow: "hidden"
  },
  progressBarFill: {
    height: 7,
    borderRadius: alchemyRadius.pill,
    backgroundColor: alchemyColors.success
  },
  progressText: {
    color: alchemyColors.grey2,
    ...alchemyTypography.micro,
    marginTop: 4
  },
  chatContent: {
    paddingHorizontal: 12,
    paddingBottom: 14,
    gap: 10
  },
  bubbleWrap: {
    width: "100%",
    flexDirection: "row"
  },
  left: {
    justifyContent: "flex-start"
  },
  right: {
    justifyContent: "flex-end"
  },
  bubble: {
    maxWidth: "86%",
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    overflow: "hidden"
  },
  assistantBubble: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.22)"
  },
  userBubble: {
    backgroundColor: "rgba(255,255,255,0.24)",
    borderColor: "rgba(255,255,255,0.34)"
  },
  bubbleText: {
    color: alchemyColors.white,
    ...alchemyTypography.body
  },
  stateCard: {
    marginHorizontal: 16,
    marginTop: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(255,255,255,0.08)",
    padding: 16,
    gap: 10,
    alignItems: "center"
  },
  stateTitleError: {
    color: alchemyColors.danger,
    ...alchemyTypography.titleLG
  },
  stateText: {
    color: alchemyColors.grey2,
    ...alchemyTypography.body,
    textAlign: "center"
  },
  retryButton: {
    borderRadius: alchemyRadius.md,
    backgroundColor: alchemyColors.grey4,
    paddingVertical: 12,
    paddingHorizontal: 20
  },
  retryButtonText: {
    color: alchemyColors.dark,
    ...alchemyTypography.bodyBold
  },
  inlineErrorWrap: {
    marginTop: 10,
    paddingHorizontal: 8
  },
  inlineErrorText: {
    color: alchemyColors.danger,
    ...alchemyTypography.micro
  },
  composerWrap: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 14,
    gap: 8
  },
  composerInner: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    color: alchemyColors.grey4,
    ...alchemyTypography.body,
    textAlignVertical: "top"
  },
  sendButton: {
    minHeight: 42,
    minWidth: 42,
    borderRadius: 12,
    backgroundColor: "rgba(31,157,115,0.95)",
    alignItems: "center",
    justifyContent: "center"
  },
  sendButtonDisabled: {
    opacity: 0.55
  },
  sendButtonText: {
    color: alchemyColors.white,
    fontSize: 18,
    fontWeight: "700"
  },
  skipLink: {
    alignSelf: "center",
    paddingHorizontal: 8,
    paddingVertical: 6
  },
  skipLinkText: {
    color: alchemyColors.grey2,
    ...alchemyTypography.caption
  }
});

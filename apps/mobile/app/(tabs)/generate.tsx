import { useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export default function GenerateScreen(): React.JSX.Element {
  const [draftId, setDraftId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!draftId) {
        return api.createDraft(message);
      }

      return api.continueDraft(draftId, message);
    },
    onSuccess: async (data) => {
      if (!draftId) {
        setDraftId(data.id);
      }

      const parsed: Message[] = data.messages.map((message) => ({
        id: message.id,
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content
      }));
      setMessages(parsed);
      setErrorMessage(null);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Could not generate recipe draft.");
    }
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      if (!draftId) {
        throw new Error("Create a draft first.");
      }

      return api.finalizeDraft(draftId);
    },
    onSuccess: async () => {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Could not save recipe.");
    }
  });

  const onSend = (): void => {
    const value = input.trim();
    if (!value) {
      return;
    }

    sendMutation.mutate(value);
    setInput("");
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={styles.container}
      keyboardVerticalOffset={92}
    >
      <View style={styles.heroWrap}>
        <Image
          source="https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=1600&q=80"
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
        />
        <LinearGradient colors={["rgba(15,23,42,0.5)", "rgba(15,23,42,0.75)"]} style={StyleSheet.absoluteFillObject} />
        <BlurView intensity={35} tint="dark" style={styles.heroGlass}>
          <View style={styles.heroContent}>
            <Text style={styles.heroTitle}>What do you want to make today?</Text>
            <Text style={styles.heroSubtitle}>Start with a dish, mood, pairing, or occasion.</Text>
          </View>
        </BlurView>
      </View>

      <View style={styles.chatWrap}>
        {sendMutation.isPending && messages.length === 0 ? (
          <View style={styles.stateCenter}>
            <ActivityIndicator />
            <Text style={styles.stateLabel}>Thinking through your recipe...</Text>
          </View>
        ) : errorMessage ? (
          <View style={styles.stateCenter}>
            <Text style={styles.errorTitle}>Something went wrong</Text>
            <Text style={styles.stateLabel}>{errorMessage}</Text>
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.stateCenter}>
            <Text style={styles.emptyTitle}>No recipe draft yet</Text>
            <Text style={styles.stateLabel}>Try “chicken parm for a romantic dinner for two”.</Text>
          </View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.assistantBubble]}>
                <Text style={[styles.bubbleText, item.role === "user" ? styles.userText : styles.assistantText]}>{item.content}</Text>
              </View>
            )}
          />
        )}

        <BlurView intensity={22} tint="light" style={styles.inputGlass}>
          <View style={styles.inputRow}>
            <TextInput
              placeholder="Describe your recipe idea..."
              value={input}
              onChangeText={setInput}
              style={styles.input}
              multiline
              placeholderTextColor="#64748B"
            />
            <Pressable style={styles.sendButton} onPress={onSend}>
              <Text style={styles.sendButtonText}>Send</Text>
            </Pressable>
          </View>
        </BlurView>

        <BlurView intensity={24} tint="light" style={styles.saveGlass}>
          <Pressable style={styles.saveButton} onPress={() => finalizeMutation.mutate()} disabled={finalizeMutation.isPending}>
            <Text style={styles.saveButtonText}>{finalizeMutation.isPending ? "Saving..." : "Save to My Cookbook"}</Text>
          </Pressable>
        </BlurView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  heroWrap: { height: 220, overflow: "hidden" },
  heroGlass: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 16,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)"
  },
  heroContent: { flex: 1, justifyContent: "flex-end", padding: 20, gap: 8 },
  heroTitle: { color: "#FFFFFF", fontSize: 30, fontWeight: "700" },
  heroSubtitle: { color: "#D6DDE4", fontSize: 14 },
  chatWrap: { flex: 1, padding: 16, gap: 12 },
  stateCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 24 },
  stateLabel: { fontSize: 14, color: "#475569", textAlign: "center" },
  errorTitle: { fontSize: 16, fontWeight: "700", color: "#B91C1C" },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: "#0F172A" },
  messageList: { gap: 10, paddingBottom: 8 },
  bubble: { borderRadius: 16, padding: 12 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#047857" },
  assistantBubble: { alignSelf: "flex-start", backgroundColor: "#E2E8F0" },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  userText: { color: "#FFFFFF" },
  assistantText: { color: "#0F172A" },
  inputGlass: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)"
  },
  inputRow: { flexDirection: "row", gap: 10, alignItems: "flex-end", padding: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    backgroundColor: "rgba(255,255,255,0.72)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14
  },
  sendButton: {
    minHeight: 44,
    minWidth: 66,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(15,23,42,0.88)"
  },
  sendButtonText: { color: "#FFFFFF", fontWeight: "700" },
  saveGlass: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)"
  },
  saveButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "rgba(4,120,87,0.92)"
  },
  saveButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 }
});

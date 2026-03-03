import SwiftUI

struct OnboardingView: View {
    @Environment(APIClient.self) private var api
    @State private var vm = OnboardingViewModel()
    let onComplete: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header

            ZStack {
                RoundedRectangle(cornerRadius: 40, style: .continuous)
                    .fill(AlchemyColors.chatPanelGradient)
                    .overlay(
                        RoundedRectangle(cornerRadius: 40, style: .continuous)
                            .stroke(AlchemyColors.borderStrong, lineWidth: 1)
                    )

                VStack(spacing: 0) {
                    if let error = vm.fatalError, vm.messages.isEmpty {
                        errorCard(error)
                    } else {
                        chatList
                    }

                    composer
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 40, style: .continuous))
            .ignoresSafeArea(.container, edges: .bottom)
        }
        .background(AlchemyColors.deepDark)
        .task {
            await vm.startIfNeeded(api: api)
        }
        .onChange(of: vm.isCompleted) { _, completed in
            if completed { onComplete() }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.sm2) {
            AlchemyTopNav(title: "Set Up Your Alchemy", trailingAction: nil)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.white.opacity(0.12))

                    Capsule()
                        .fill(AlchemyColors.grey4)
                        .frame(width: max(geo.size.width * max(vm.progress, 0.08), 20))
                }
            }
            .frame(height: 7)
            .padding(.horizontal, Spacing.md)

            Text("\(Int(vm.progress * 100))% complete")
                .font(AlchemyFont.micro)
                .foregroundStyle(AlchemyColors.textSecondary)
                .padding(.horizontal, Spacing.md)
        }
        .padding(.bottom, Spacing.md)
    }

    // MARK: - Chat List

    private var chatList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: Spacing.sm) {
                    if vm.messages.isEmpty {
                        loadingCard
                    }

                    ForEach(vm.messages) { message in
                        chatBubble(message)
                            .id(message.id)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }

                    if let error = vm.fatalError, !vm.messages.isEmpty {
                        Text(error)
                            .font(AlchemyFont.captionLight)
                            .foregroundStyle(AlchemyColors.danger)
                            .padding(.horizontal, Spacing.sm)
                    }
                }
                .padding(.horizontal, Spacing.sm2)
                .padding(.bottom, Spacing.sm)
            }
            .onChange(of: vm.messages.count) { _, _ in
                if let lastId = vm.messages.last?.id {
                    withAnimation(.spring(response: 0.4)) {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
        }
    }

    // MARK: - Chat Bubble

    private func chatBubble(_ message: ChatMessage) -> some View {
        HStack {
            if message.role == "user" { Spacer(minLength: 40) }

            Text(message.content)
                .font(AlchemyFont.chatBody)
                .foregroundStyle(AlchemyColors.textPrimary)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.sm2)
                .background {
                    RoundedRectangle(cornerRadius: Radius.xl)
                        .fill(message.role == "assistant"
                            ? Color.white.opacity(0.08)
                            : Color.white.opacity(0.16))
                        .overlay {
                            RoundedRectangle(cornerRadius: Radius.xl)
                                .stroke(Color.white.opacity(message.role == "assistant" ? 0.2 : 0.35), lineWidth: 0.5)
                        }
                }

            if message.role == "assistant" { Spacer(minLength: 40) }
        }
    }

    // MARK: - Loading Card

    private var loadingCard: some View {
        VStack(spacing: Spacing.sm) {
            ProgressView()
                .tint(AlchemyColors.grey2)
            Text("Starting your onboarding interview...")
                .font(AlchemyFont.body)
                .foregroundStyle(AlchemyColors.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(Spacing.md)
        .background {
            RoundedRectangle(cornerRadius: Radius.lg)
                .fill(Color.white.opacity(0.06))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.lg)
                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                }
        }
        .padding(.horizontal, Spacing.sm)
    }

    // MARK: - Error Card

    private func errorCard(_ message: String) -> some View {
        VStack(spacing: Spacing.sm) {
            Text("Interview unavailable")
                .font(AlchemyFont.titleMD)
                .foregroundStyle(AlchemyColors.danger)

            Text(message)
                .font(AlchemyFont.body)
                .foregroundStyle(AlchemyColors.textSecondary)
                .multilineTextAlignment(.center)

            AlchemyButton(title: "Retry", variant: .secondary) {
                Task { await vm.retry(api: api) }
            }
            .frame(width: 160)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(Spacing.md)
    }

    // MARK: - Composer

    private var composer: some View {
        VStack(spacing: Spacing.sm) {
            HStack(alignment: .bottom, spacing: Spacing.sm) {
                TextField("I have a La Cornue stove, and a", text: $vm.input, axis: .vertical)
                    .font(AlchemyFont.body)
                    .foregroundStyle(AlchemyColors.textPrimary)
                    .tint(AlchemyColors.gold)
                    .lineLimit(1...5)
                    .padding(.horizontal, Spacing.sm2)
                    .padding(.vertical, Spacing.sm)
                    .frame(minHeight: 42)

                Button {
                    Task { await vm.submit(api: api) }
                } label: {
                    Image(systemName: "paperplane")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(vm.isLoading ? AlchemyColors.grey1 : AlchemyColors.grey4)
                        .frame(width: 32, height: 32)
                }
                .disabled(vm.isLoading || vm.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(.horizontal, Spacing.sm2)
            .frame(height: 56)
            .background(AlchemyColors.dark)
            .clipShape(RoundedRectangle(cornerRadius: Radius.lg))

            Button {
                Task { await vm.skipOnboarding(api: api) }
            } label: {
                Text("Skip for now")
                    .font(AlchemyFont.caption)
                    .foregroundStyle(AlchemyColors.textSecondary)
            }
            .disabled(vm.isLoading)
        }
        .padding(.horizontal, Spacing.sm2)
        .padding(.vertical, Spacing.sm)
    }
}

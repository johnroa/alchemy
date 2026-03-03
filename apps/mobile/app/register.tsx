import { Redirect } from "expo-router";
import { AuthScreen } from "@/components/alchemy/auth-screen";
import { useAuth } from "@/lib/auth";

export default function RegisterScreen(): React.JSX.Element {
  const { isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Redirect href="/(tabs)/my-cookbook" />;
  }

  return <AuthScreen mode="register" />;
}

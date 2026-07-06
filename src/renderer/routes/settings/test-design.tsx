import { Box, Stack, Text, Title } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/test-design')({
  component: RouteComponent,
})

export function RouteComponent() {
  return (
    <Stack p="md" gap="lg">
      <Title order={4}>V2Chat Design System Test</Title>

      {/* 测试卡片 1 */}
      <Box className="v2chat-settings-card">
        <Text fw={600} mb="xs">🎭 Model Configuration</Text>
        <Text size="sm" c="chatbox-secondary">
          Configure your AI models and providers here
        </Text>
      </Box>

      {/* 测试卡片 2 */}
      <Box className="v2chat-settings-card">
        <Text fw={600} mb="xs">🔑 API Settings</Text>
        <Text size="sm" c="chatbox-secondary">
          Manage your API keys and endpoints
        </Text>
      </Box>

      {/* 测试卡片 3 */}
      <Box className="v2chat-settings-card">
        <Text fw={600} mb="xs">🎨 Appearance</Text>
        <Text size="sm" c="chatbox-secondary">
          Customize the look and feel of V2Chat
        </Text>
      </Box>

      {/* 测试卡片 4 */}
      <Box className="v2chat-settings-card">
        <Text fw={600} mb="xs">ℹ️ About</Text>
        <Text size="sm" c="chatbox-secondary">
          Version information and support
        </Text>
      </Box>
    </Stack>
  )
}

import BorrowLab from './borrowlab';
import { getChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await getChatGPTUser();
  return <BorrowLab user={user ? { userId: user.userId, displayName: user.displayName } : null} />;
}

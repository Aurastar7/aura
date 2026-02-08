export type ThemeMode = 'light' | 'dark';
export type UserRole = 'user' | 'moderator' | 'curator' | 'admin';
export type AppView =
  | 'feed'
  | 'explore'
  | 'notifications'
  | 'messages'
  | 'profile'
  | 'groups'
  | 'admin';

export type MediaType = 'image' | 'video';
export type NotificationType =
  | 'system'
  | 'follow'
  | 'post_like'
  | 'post_repost'
  | 'post_comment'
  | 'comment_mention'
  | 'group_post_like'
  | 'moderation';

export interface User {
  id: string;
  username: string;
  password: string;
  displayName: string;
  bio: string;
  status: string;
  avatar: string;
  coverImage: string;
  role: UserRole;
  banned: boolean;
  restricted: boolean;
  verified: boolean;
  hiddenFromFriends: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

export interface Follow {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: string;
}

export interface Post {
  id: string;
  authorId: string;
  text: string;
  mediaType?: MediaType;
  mediaUrl?: string;
  createdAt: string;
  likedBy: string[];
  repostedBy: string[];
  repostOfPostId?: string;
  repostOfGroupPostId?: string;
  repostSourceGroupId?: string;
}

export interface PostComment {
  id: string;
  postId: string;
  authorId: string;
  text: string;
  likedBy: string[];
  createdAt: string;
}

export interface Story {
  id: string;
  authorId: string;
  caption: string;
  mediaType: MediaType;
  mediaUrl: string;
  createdAt: string;
  expiresAt: string;
}

export interface StoryComment {
  id: string;
  storyId: string;
  authorId: string;
  text: string;
  createdAt: string;
}

export interface Message {
  id: string;
  fromId: string;
  toId: string;
  text: string;
  mediaType?: 'image' | 'voice';
  mediaUrl?: string;
  expiresAt?: string;
  editedAt?: string;
  readBy: string[];
  createdAt: string;
}

export type GroupMemberRole = 'admin' | 'member';

export interface Group {
  id: string;
  name: string;
  description: string;
  adminId: string;
  allowMemberPosts: boolean;
  avatar: string;
  coverImage: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: GroupMemberRole;
  createdAt: string;
}

export interface GroupPost {
  id: string;
  groupId: string;
  authorId: string;
  text: string;
  mediaType?: MediaType;
  mediaUrl?: string;
  createdAt: string;
  likedBy: string[];
  repostedBy: string[];
  repostOfPostId?: string;
}

export interface GroupPostComment {
  id: string;
  groupPostId: string;
  authorId: string;
  text: string;
  likedBy: string[];
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  actorId?: string;
  type: NotificationType;
  text: string;
  postId?: string;
  groupPostId?: string;
  groupId?: string;
  commentId?: string;
  createdAt: string;
  read: boolean;
}

export interface SessionState {
  userId: string | null;
  currentView: AppView;
  activeChatUserId: string | null;
  activeGroupId: string | null;
}

export interface SocialDb {
  users: User[];
  follows: Follow[];
  posts: Post[];
  postComments: PostComment[];
  stories: Story[];
  storyComments: StoryComment[];
  messages: Message[];
  groups: Group[];
  groupMembers: GroupMember[];
  groupPosts: GroupPost[];
  groupPostComments: GroupPostComment[];
  notifications: NotificationItem[];
  theme: ThemeMode;
  session: SessionState;
}

export interface RegisterPayload {
  username: string;
  displayName: string;
  password: string;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface PostPayload {
  text: string;
  mediaType?: MediaType;
  mediaUrl?: string;
}

export interface StoryPayload {
  caption: string;
  mediaType: MediaType;
  mediaUrl: string;
}

export interface GroupPayload {
  name: string;
  description: string;
  allowMemberPosts: boolean;
}

export interface GroupPatch {
  name: string;
  description: string;
  avatar: string;
  coverImage: string;
  verified: boolean;
  allowMemberPosts: boolean;
}

export interface ProfilePatch {
  displayName: string;
  bio: string;
  status: string;
  avatar: string;
  coverImage: string;
  hiddenFromFriends: boolean;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

import React from 'react';
import { Story, User } from '../types';
import { userAvatar } from '../utils/ui';

interface StoryBarProps {
  stories: Story[];
  usersById: Record<string, User>;
  currentUserId: string;
  onCreateStory: () => void;
  onOpenStory: (storyId: string) => void;
}

const StoryBar: React.FC<StoryBarProps> = ({
  stories,
  usersById,
  currentUserId,
  onCreateStory,
  onOpenStory,
}) => {
  return (
    <div className="flex gap-5 overflow-x-auto px-6 py-6 items-center border-b border-slate-100 dark:border-slate-800">
      <button onClick={onCreateStory} className="flex flex-col items-center gap-2 flex-shrink-0 cursor-pointer group">
        <div className="relative p-1 rounded-[22px] bg-slate-100 dark:bg-slate-800">
          <img src={userAvatar(usersById[currentUserId])} className="w-16 h-16 rounded-[18px] object-cover border-2 border-white dark:border-slate-900" alt="" />
          <div className="absolute -bottom-1 -right-1 bg-slate-900 dark:bg-white dark:text-black text-white rounded-full p-1 border-2 border-white dark:border-slate-900">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4" /></svg>
          </div>
        </div>
        <span className="text-[11px] font-semibold truncate w-16 text-center text-slate-900 dark:text-slate-200">Your Aura</span>
      </button>

      {stories.map((story) => {
        const owner = usersById[story.authorId];
        if (!owner) return null;
        const seenStyle =
          story.authorId === currentUserId
            ? 'bg-slate-200 dark:bg-slate-700'
            : 'bg-gradient-to-tr from-slate-900 to-slate-500';
        return (
          <button key={story.id} onClick={() => onOpenStory(story.id)} className="flex flex-col items-center gap-2 flex-shrink-0 cursor-pointer group">
            <div className={`relative p-1 rounded-[22px] transition-transform group-hover:scale-105 ${seenStyle}`}>
              <img src={userAvatar(owner)} className="w-16 h-16 rounded-[18px] object-cover border-2 border-white dark:border-slate-900" alt="" />
            </div>
            <span className="text-[11px] font-semibold truncate w-16 text-center text-slate-500 dark:text-slate-300">{owner.displayName}</span>
          </button>
        );
      })}

      {stories.length === 0 ? (
        <div className="text-sm text-slate-500 py-4">No stories yet</div>
      ) : null}
    </div>
  );
};

export default StoryBar;

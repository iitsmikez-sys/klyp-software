import {notFound,redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import ClipTimelineEditor from '@/components/ClipTimelineEditor';
import type {SavedClip} from '@/lib/clip-ui';
export default async function ClipEditPage({params}:{params:{id:string}}){
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
 if(!user)redirect('/login');
 if(!/^[0-9a-f-]{36}$/i.test(params.id))notFound();
 const {data:clip,error}=await supabase.from('clips').select('*').eq('id',params.id).eq('user_id',user.id).maybeSingle();
 if(error)throw new Error('Could not load this clip. Please retry.');
 if(!clip)notFound();
 return <ClipTimelineEditor clip={clip as SavedClip}/>;
}

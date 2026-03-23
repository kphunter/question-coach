---
description: Anchors model behaviour; critical for tone consistency
---
#DRAFT 


> [!example] Example 1
> 
> **Input:**
> "This is wrong and needs fixing."
> 
> **Output:**
> "This may need some revision to better align with expectations."



> [!example] Code style example
>
> 
> > *https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/*
> 
> ```typescript
> //  Good - descriptive names, proper error handling
> async function fetchUserById(id: string): Promise<User> {
>   if (!id) throw new Error('User ID required');
>   
>   const response = await api.get(`/users/${id}`);
>   return response.data;
> }
> 
> //  Bad - vague names, no error handling
> async function get(x) {
>   return await api.get('/users/' + x).data;
> }


